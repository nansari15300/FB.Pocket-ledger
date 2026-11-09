"use client";

/**
 * Never-synced local doc => permanent local delete (no Firestore, no recycle bin, no history).
 * Any doubt => "soft" => caller runs today's soft delete unchanged.
 */

import { deleteDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { getDocFromCache } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { getBrowserDbForCompanyId, scheduleBrowserDbPersistAfterWrite, flushPendingBrowserDbSave } from "@/lib/localSqlite";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY } from "@/lib/localMirrorServerMeta";
import { isCompanyDocOutboxInFlight, awaitVoucherOutboxFlushIdle } from "@/lib/localVoucherOutbox";
import {
  localOnlyHardDeleteConfirmText,
  decideNeverSyncedLocalDoc,
  neverSyncedFailReasons,
  type NeverSyncedSignals,
  type FirestoreCacheState,
  docHasCrossLinkFields,
  pendingDocPathMatches,
} from "@/lib/localOnlyHardDeleteRules";

export { localOnlyHardDeleteConfirmText };

type Db = NonNullable<Awaited<ReturnType<typeof getBrowserDbForCompanyId>>>;

function readLocalDoc(db: Db, cid: string, coll: string, id: string): Record<string, unknown> | null {
  const row = db
    .prepare("SELECT data FROM company_docs WHERE company_id = ? AND collection = ? AND id = ?")
    .get(cid, coll, id) as { data?: string } | undefined;
  if (!row?.data) return null;
  try {
    const parsed = JSON.parse(String(row.data));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hasUnsentCreateRow(db: Db, cid: string, coll: string, id: string): boolean {
  const r = db
    .prepare(
      "SELECT 1 AS x FROM sync_outbox WHERE company_id = ? AND collection_name = ? AND doc_id = ? AND op = 'create' LIMIT 1"
    )
    .get(cid, coll, id) as { x?: number } | undefined;
  return Boolean(r?.x);
}

function referencedElsewhere(db: Db, cid: string, coll: string, id: string): boolean {
  const r = db
    .prepare(
      // Only other live vouchers count (allocations / links). Logs, counters, history docs etc. are ignored.
      "SELECT 1 AS x FROM company_docs WHERE company_id = ? AND collection = 'vouchers' AND NOT (collection = ? AND id = ?) AND instr(data, ?) > 0 AND instr(data, '\"isDeleted\":true') = 0 LIMIT 1"
    )
    .get(cid, coll, id, `"${id}"`) as { x?: number } | undefined;
  return Boolean(r?.x);
}

async function firestoreDocPath(cid: string, coll: string, id: string): Promise<string> {
  const reg = await getLocalCompanyById(cid, { includeDeleted: true }).catch(() => null);
  const fsId = String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || cid).trim() || cid;
  return `companies/${fsId}/${coll}/${id}`;
}

/**
 * SDK cache: a doc written by setDoc/addDoc that the server never acknowledged (quota, offline) is in the cache
 * with `metadata.hasPendingWrites === true` — that is NOT synced.
 */
async function firestoreCacheState(cid: string, coll: string, id: string): Promise<{ state: FirestoreCacheState; code?: string }> {
  try {
    const snap = await getDocFromCache(doc(firestore, await firestoreDocPath(cid, coll, id)));
    if (!snap.exists()) return { state: "absent" };
    return { state: snap.metadata.hasPendingWrites ? "pending" : "synced" };
  } catch (e) {
    const code = String((e as { code?: string } | null)?.code || "");
    // Not in cache => "unavailable". Anything else = doubt.
    return code === "unavailable" ? { state: "absent", code } : { state: "unknown", code };
  }
}

function outboxDiag(db: Db, cid: string, coll: string, id: string): { ops: string[]; statuses: string[] } {
  try {
    const rows = db
      .prepare("SELECT op, status FROM sync_outbox WHERE company_id = ? AND collection_name = ? AND doc_id = ?")
      .all(cid, coll, id) as Array<{ op?: string; status?: string | null }>;
    return { ops: rows.map((r) => String(r.op ?? "")), statuses: rows.map((r) => String(r.status ?? "pending")) };
  } catch {
    return { ops: [], statuses: [] };
  }
}
export type NeverSyncedExplain = { ok: boolean; signals: NeverSyncedSignals | null; reasons: string[] };

async function waitFlushIdleWithTimeout(ms: number): Promise<void> {
  await Promise.race([awaitVoucherOutboxFlushIdle(), new Promise<void>((r) => setTimeout(r, ms))]);
}

/** Full check with per-condition result (console diagnostics). Any doubt => ok:false. */
export async function explainNeverSyncedLocalDoc(
  companyId: string,
  collectionName: string,
  docId: string
): Promise<NeverSyncedExplain> {
  const cid = String(companyId || "").trim();
  const id = String(docId || "").trim();
  if (!cid || !collectionName || !id || typeof window === "undefined") {
    return { ok: false, signals: null, reasons: ["missing company/doc id"] };
  }
  try {
    if (isCompanyDocOutboxInFlight(cid, collectionName, id)) {
      await waitFlushIdleWithTimeout(8000);
    }
    const db = await getBrowserDbForCompanyId(cid);
    if (!db) return { ok: false, signals: null, reasons: ["no local SQLite db"] };
    const data = readLocalDoc(db, cid, collectionName, id);
    const cacheState = (await firestoreCacheState(cid, collectionName, id)).state;
    const signals: NeverSyncedSignals = {
      hasLocalDoc: Boolean(data),
      mirrorBackedByFirestore: Boolean(data && data[LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY]),
      hasUnsentCreateRow: hasUnsentCreateRow(db, cid, collectionName, id),
      firestoreCache: cacheState,
      hasPendingWrites: cacheState === "pending",
      inFlight: isCompanyDocOutboxInFlight(cid, collectionName, id),
      hasCrossLinks: docHasCrossLinkFields(data),
      referencedElsewhere: referencedElsewhere(db, cid, collectionName, id),
    };
    const od = outboxDiag(db, cid, collectionName, id);
    signals.outboxOps = od.ops;
    signals.outboxStatuses = od.statuses;
    const ok = decideNeverSyncedLocalDoc(signals);
    const reasons = neverSyncedFailReasons(signals);
    console.info(`[localOnlyHardDelete] check ${collectionName}/${id} (company ${cid}) ok=${ok} reasons=${reasons.join(" | ") || "none"} signals=${JSON.stringify(signals)}`);
    return { ok, signals, reasons };
  } catch (e) {
    console.warn("[localOnlyHardDelete] check failed => soft delete", e);
    return { ok: false, signals: null, reasons: [`check error: ${String((e as Error)?.message || e)}`] };
  }
}

/** All checks must pass; any doubt => false (soft delete). */
export async function isNeverSyncedLocalDoc(companyId: string, collectionName: string, docId: string): Promise<boolean> {
  return (await explainNeverSyncedLocalDoc(companyId, collectionName, docId)).ok;
}

/** UI already confirmed inside the delete dialog => skip window.confirm once for this doc (60s). */
const confirmedIntents = new Map<string, number>();
const intentKey = (c: string, k: string, i: string) => `${String(c).trim()}|${k}|${String(i).trim()}`;
export function armLocalOnlyHardDeleteIntent(companyId: string, collectionName: string, docId: string): void {
  confirmedIntents.set(intentKey(companyId, collectionName, docId), Date.now() + 60_000);
}
export function consumeLocalOnlyHardDeleteIntent(companyId: string, collectionName: string, docId: string): boolean {
  const k = intentKey(companyId, collectionName, docId);
  const exp = confirmedIntents.get(k);
  confirmedIntents.delete(k);
  return typeof exp === "number" && exp >= Date.now();
}
function collectLocalFileIds(data: Record<string, unknown> | null): string[] {
  if (!data) return [];
  const out = new Set<string>();
  const re = /local:([A-Za-z0-9_.\-]+)/g;
  const s = JSON.stringify(data);
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.add(m[1]);
  return Array.from(out);
}

/**
 * One SQLite transaction (company scoped): company_docs + projection + sync_outbox + cloud_sync_outbox.
 * Then pending files/blobs not used by any other doc, save DB, live-patch UI. Returns false if re-check fails.
 */
export async function hardDeleteLocalOnlyDoc(companyId: string, collectionName: string, docId: string): Promise<boolean> {
  const cid = String(companyId || "").trim();
  const id = String(docId || "").trim();
  const db = await getBrowserDbForCompanyId(cid);
  if (!db) return false;
  const data = readLocalDoc(db, cid, collectionName, id);
  const cache = await firestoreCacheState(cid, collectionName, id);
  if (cache.state === "synced" || cache.state === "unknown") return false;
  const sdkPending = cache.state === "pending";
  db.exec("BEGIN");
  try {
    if ((!hasUnsentCreateRow(db, cid, collectionName, id) && !sdkPending) || isCompanyDocOutboxInFlight(cid, collectionName, id)) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare("DELETE FROM company_docs WHERE company_id = ? AND collection = ? AND id = ?").run(cid, collectionName, id);
    db.prepare("DELETE FROM company_docs_projection WHERE company_id = ? AND collection = ? AND id = ?").run(
      cid,
      collectionName,
      id
    );
    db.prepare("DELETE FROM sync_outbox WHERE company_id = ? AND collection_name = ? AND doc_id = ?").run(
      cid,
      collectionName,
      id
    );
    db.prepare("DELETE FROM cloud_sync_outbox WHERE company_id = ? AND row_id = ? AND synced_at IS NULL").run(cid, id);
    db.exec("COMMIT");
    if (sdkPending) {
      // Cancel the SDK's queued (never acknowledged) write: deleteDoc queues a delete after it, so if the queue
      // ever reaches the server the net result is 'no doc'. Do not await - under quota/offline it never resolves.
      void firestoreDocPath(cid, collectionName, id)
        .then((path) => deleteDoc(doc(firestore, path)))
        .catch((e) => console.warn("[localOnlyHardDelete] SDK pending write cancel failed", e));
    }
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }

  // Pending files (docPath match + local: refs) — only when no other doc still uses the file key.
  try {
    const { listPendingFilesForCompany, removePendingFile } = await import("@/lib/localPendingFiles");
    const ids = new Set<string>(collectLocalFileIds(data));
    const pending = await listPendingFilesForCompany(cid).catch(() => []);
    for (const p of pending) {
      if (p?.id && pendingDocPathMatches(String(p.docPath || ""), collectionName, id)) ids.add(String(p.id));
    }
    for (const fileId of ids) {
      const used = db
        .prepare("SELECT 1 AS x FROM company_docs WHERE instr(data, ?) > 0 LIMIT 1")
        .get(`local:${fileId}`) as { x?: number } | undefined;
      if (used?.x) continue;
      await removePendingFile(fileId).catch(() => undefined);
    }
  } catch (e) {
    console.warn("[localOnlyHardDelete] pending file cleanup skipped", e);
  }

  scheduleBrowserDbPersistAfterWrite();
  await flushPendingBrowserDbSave().catch(() => undefined);
  try {
    const { notifyBrowserDbCollectionUpdated } = await import("@/lib/localCompanyDocMirror");
    notifyBrowserDbCollectionUpdated(cid, collectionName, { immediate: true });
    if (collectionName === "vouchers") {
      const { dispatchVoucherLivePatch } = await import("@/lib/voucherFormAttachmentSave");
      dispatchVoucherLivePatch(cid, id, { isDeleted: true });
    }
  } catch {
    /* UI refresh best-effort */
  }
  return true;
}

/**
 * Shared delete hook. "soft" => run existing soft delete; "hard" => done; "cancelled" => user said no.
 * Confirm order: dialog intent (armed by MasterDeleteConfirmAlertDialog) => no prompt;
 * else `options.confirm` fn; `confirm: false` => no prompt; default window.confirm (paths without UI).
 */
export async function tryHardDeleteNeverSyncedDoc(
  companyId: string,
  collectionName: string,
  docId: string,
  options?: { confirm?: ((text: string) => boolean | Promise<boolean>) | false }
): Promise<"hard" | "soft" | "cancelled"> {
  const preConfirmed = consumeLocalOnlyHardDeleteIntent(companyId, collectionName, docId);
  if (!(await isNeverSyncedLocalDoc(companyId, collectionName, docId))) return "soft";
  if (!preConfirmed && options?.confirm !== false) {
    const ask =
      options?.confirm ??
      ((t: string) => (typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(t) : false));
    const ok = await ask(localOnlyHardDeleteConfirmText(collectionName));
    if (!ok) return "cancelled";
  }
  try {
    return (await hardDeleteLocalOnlyDoc(companyId, collectionName, docId)) ? "hard" : "soft";
  } catch (e) {
    console.warn("[localOnlyHardDelete] hard delete failed => soft delete", e);
    return "soft";
  }
}

/** Permanent-delete path: only when the dialog armed the intent; never prompts. */
export async function tryLocalOnlyHardDeleteFromDialogIntent(
  companyId: string,
  collectionName: string,
  docId: string
): Promise<boolean> {
  if (!consumeLocalOnlyHardDeleteIntent(companyId, collectionName, docId)) return false;
  if (!(await isNeverSyncedLocalDoc(companyId, collectionName, docId))) return false;
  try {
    return await hardDeleteLocalOnlyDoc(companyId, collectionName, docId);
  } catch (e) {
    console.warn("[localOnlyHardDelete] hard delete failed", e);
    return false;
  }
}