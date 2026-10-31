"use client";

/**
 * Deep check (PocketBase companies only, user-started from the Sync info dialog).
 *
 * Reads a LIGHT index of the server (fields-limited: app_id, kind, coll, updatedAtMs, deleted - no document
 * bodies, 500 rows per request, one pass per server collection) and compares it with the local SQLite mirror.
 * Only records that are missing on the server, or whose local edit is newer than the server copy, are pushed
 * (queued in the normal outbox, so attachments are uploaded the usual way). Nothing else is read or written.
 */

import { getBrowserDbForCompanyId } from "@/lib/localSqlite";
import { deserializeLocalDbValue, mirrorDocEditTimeMs } from "@/lib/localCompanyDocMirror";
import { getValidPocketBaseAuth, pbListAll, pbQuote } from "@/lib/pocketbaseData/pbClient";
import { appCollectionForPbRecord, PB_DATA_COLLECTIONS, pbTargetForAppCollection } from "@/lib/pocketbaseData/pbMapping";
import { ensurePocketBaseCompany, pbServerTime } from "@/lib/pocketbaseData/pbSync";
import { requeueLocalDocsToOutbox } from "@/lib/localVoucherOutbox";
import { flushPbOutboxForCompany, type DocRef, type SyncNowProgress } from "@/lib/syncCompanyNow";
import { yieldToMain } from "@/lib/yieldToMain";

/** Server updatedAtMs vs local edit time: ignore differences below this (clock skew / rounding). */
const NEWER_TOLERANCE_MS = 5000;
const REQUEUE_CHUNK = 100;
const MAX_LISTED_IN_UI = 12;

export type PbDeepCheckResult = {
  /** Local docs checked. */
  localChecked: number;
  /** Server rows listed (light index). */
  serverListed: number;
  /** In local SQLite, not on the server (or only as a tombstone while local is live). */
  missing: DocRef[];
  /** Local edit is newer than the server copy. */
  newer: DocRef[];
  /** First few differing records, for display. */
  sample: Array<DocRef & { reason: "missing" | "newer" }>;
  scannedAt: number;
};

type ServerRow = { ms: number; deleted: boolean };

function key(coll: string, id: string): string {
  return `${coll}\u0000${id}`;
}

/** Read-only scan: light server index vs local mirror. Nothing is written. */
export async function runPbDeepCheckScan(
  companyId: string,
  onProgress?: (p: SyncNowProgress) => void
): Promise<PbDeepCheckResult> {
  const cid = String(companyId || "").trim();
  if (!cid) throw new Error("No company selected.");
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("You are offline.");
  if (!getValidPocketBaseAuth()) throw new Error("Not signed in to Pocket Ledger Server.");
  const db = await getBrowserDbForCompanyId(cid);
  if (!db) throw new Error("Local data is not available on this device.");

  const companyRec = await ensurePocketBaseCompany(cid);
  const cf = `company = ${pbQuote(companyRec)}`;

  // 1) light server index (fields-limited, paged)
  const server = new Map<string, ServerRow>();
  const totalSteps = PB_DATA_COLLECTIONS.length + 1;
  for (let i = 0; i < PB_DATA_COLLECTIONS.length; i++) {
    const collection = PB_DATA_COLLECTIONS[i]!;
    onProgress?.({ phase: "Reading server index", done: i, total: totalSteps, detail: collection.replace(/^pl_/, "") });
    await pbListAll<Record<string, unknown>>(collection, cf, {
      fields: "app_id,kind,coll,updatedAtMs,deleted",
      discard: true,
      onPage: (items) => {
        for (const rec of items) {
          const appColl = appCollectionForPbRecord(collection, rec);
          const appId = String(rec.app_id ?? "").trim();
          if (!appColl || !appId) continue;
          server.set(key(appColl, appId), {
            ms: Number(rec.updatedAtMs) || 0,
            deleted: rec.deleted === true,
          });
        }
      },
    });
    await yieldToMain();
  }

  // 2) local mirror (SQLite only)
  onProgress?.({ phase: "Comparing with this device", done: PB_DATA_COLLECTIONS.length, total: totalSteps });
  const { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } = await import("@/lib/firestoreToLocalCompanyPull");
  const missing: DocRef[] = [];
  const newer: DocRef[] = [];
  let localChecked = 0;
  for (const coll of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
    if (!pbTargetForAppCollection(coll)) continue;
    const rows = db
      .prepare(`SELECT id, data FROM company_docs WHERE company_id = ? AND collection = ?`)
      .all(cid, coll) as Array<{ id: string; data: string }>;
    let n = 0;
    for (const r of rows) {
      n++;
      if (n % 200 === 0) await yieldToMain();
      let local: Record<string, unknown>;
      try {
        local = deserializeLocalDbValue(JSON.parse(r.data)) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!local || typeof local !== "object") continue;
      localChecked++;
      const localDeleted = local.isDeleted === true;
      const srv = server.get(key(coll, r.id));
      if (!srv) {
        // A local tombstone that the server never had needs nothing.
        if (!localDeleted) missing.push({ coll, id: r.id });
        continue;
      }
      if (srv.deleted && !localDeleted) {
        // Server says deleted. Push only when the local edit is clearly newer (re-created / restored here).
        const localMs = mirrorDocEditTimeMs(local);
        if (localMs > 0 && pbServerTime(localMs) > srv.ms + NEWER_TOLERANCE_MS) newer.push({ coll, id: r.id });
        continue;
      }
      const localMs = mirrorDocEditTimeMs(local);
      if (localMs > 0 && pbServerTime(localMs) > srv.ms + NEWER_TOLERANCE_MS) newer.push({ coll, id: r.id });
    }
  }
  onProgress?.({ phase: "Done", done: totalSteps, total: totalSteps });

  const sample: PbDeepCheckResult["sample"] = [];
  for (const d of missing) {
    if (sample.length >= MAX_LISTED_IN_UI) break;
    sample.push({ ...d, reason: "missing" });
  }
  for (const d of newer) {
    if (sample.length >= MAX_LISTED_IN_UI) break;
    sample.push({ ...d, reason: "newer" });
  }
  return { localChecked, serverListed: server.size, missing, newer, sample, scannedAt: Date.now() };
}

/** Push only the differing docs: queue them in the outbox, then run the bounded flush for this company. */
export async function pushPbDeepCheckDiffs(
  companyId: string,
  result: Pick<PbDeepCheckResult, "missing" | "newer">,
  onProgress?: (p: SyncNowProgress) => void
): Promise<{ queued: number; sent: number; failed: number; remaining: number }> {
  const cid = String(companyId || "").trim();
  if (!cid) throw new Error("No company selected.");
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("You are offline.");
  if (!getValidPocketBaseAuth()) throw new Error("Not signed in to Pocket Ledger Server.");
  const all = [...result.missing, ...result.newer];
  let queued = 0;
  for (let i = 0; i < all.length; i += REQUEUE_CHUNK) {
    const chunk = all.slice(i, i + REQUEUE_CHUNK).map((d) => ({ collectionName: d.coll, docId: d.id }));
    queued += await requeueLocalDocsToOutbox(cid, chunk);
    onProgress?.({ phase: "Queueing records", done: Math.min(all.length, i + chunk.length), total: all.length });
    await yieldToMain();
  }
  const flush = await flushPbOutboxForCompany(cid, (p) => onProgress?.({ ...p, phase: "Uploading records" }));
  return { queued, sent: flush.ok, failed: flush.failed, remaining: flush.remaining };
}