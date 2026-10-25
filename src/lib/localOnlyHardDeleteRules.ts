/**
 * Pure rules for "never synced" local-only hard delete (no imports; tsx self-test friendly).
 * Any doubt => false => caller keeps the normal soft delete (recycle bin).
 */

export const LOCAL_ONLY_HARD_DELETE_CONFIRM_TEXT_VOUCHER =
  "This voucher is only on this device (not synced online). Deleting will remove it permanently.";
export const LOCAL_ONLY_HARD_DELETE_CONFIRM_TEXT_RECORD =
  "This record is only on this device (not synced online). Deleting will remove it permanently.";

/** Voucher vs master/other decided by collection name. */
export function localOnlyHardDeleteConfirmText(collectionName: string): string {
  return String(collectionName || "").trim() === "vouchers"
    ? LOCAL_ONLY_HARD_DELETE_CONFIRM_TEXT_VOUCHER
    : LOCAL_ONLY_HARD_DELETE_CONFIRM_TEXT_RECORD;
}

/**
 * Firestore SDK local cache state for the doc:
 * - "absent"  : not in cache (getDocFromCache => unavailable)
 * - "synced"  : in cache, no pending writes => server has (had) it
 * - "pending" : in cache ONLY via an unacknowledged local SDK write (hasPendingWrites) => never reached server
 * - "unknown" : cache check failed for another reason => doubt
 */
export type FirestoreCacheState = "absent" | "synced" | "pending" | "unknown";

export type NeverSyncedSignals = {
  /** Local doc row exists in company_docs. */
  hasLocalDoc: boolean;
  /** `__mirrorBackedByFirestore` stamp present on the local doc. */
  mirrorBackedByFirestore: boolean;
  /** Unsent `op = "create"` row in sync_outbox (any status: pending/failed/paused). */
  hasUnsentCreateRow: boolean;
  firestoreCache: FirestoreCacheState;
  /** Diagnostic mirror of firestoreCache === "pending" (SDK unacknowledged local write). */
  hasPendingWrites?: boolean;
  /** Outbox flush currently sending a row for this doc. */
  inFlight: boolean;
  /** Inter-company / linked / recurring / allocation fields present. */
  hasCrossLinks: boolean;
  /** Another live voucher references this id. */
  referencedElsewhere: boolean;
  /** Diagnostics only. */
  outboxOps?: string[];
  outboxStatuses?: string[];
};

/** SDK-only pending write (e.g. setDoc retried forever under quota) is local-only evidence. */
function sdkPendingOnly(s: NeverSyncedSignals): boolean {
  return s.firestoreCache === "pending";
}

/** Which checks failed (empty => never synced). Used for console diagnostics. */
export function neverSyncedFailReasons(s: NeverSyncedSignals): string[] {
  const r: string[] = [];
  if (!s.hasLocalDoc) r.push("no local doc");
  // A listener/getDoc on an SDK pending write stamps the mirror flag too — ignore the stamp in that case.
  if (s.mirrorBackedByFirestore && !sdkPendingOnly(s)) r.push("__mirrorBackedByFirestore set (came from / confirmed by server)");
  if (!s.hasUnsentCreateRow && !sdkPendingOnly(s))
    r.push("no unsent create row in sync_outbox and no SDK pending write (already uploaded or never queued)");
  if (s.firestoreCache === "synced") r.push("in Firestore cache without pending writes (server has it)");
  if (s.firestoreCache === "unknown") r.push("Firestore cache check inconclusive");
  if (s.inFlight) r.push("outbox upload in flight");
  if (s.hasCrossLinks) r.push("has inter-company/linked/recurring/allocation fields");
  if (s.referencedElsewhere) r.push("referenced by another voucher");
  return r;
}

export function decideNeverSyncedLocalDoc(s: NeverSyncedSignals): boolean {
  return neverSyncedFailReasons(s).length === 0;
}
const CROSS_LINK_KEY_RE = /^(interCompany|intercompany|linked|recurring|pair|mirrorOf|sourceVoucher|sourceDoc|counterpart|parentVoucher)/;

function nonEmpty(v: unknown): boolean {
  if (v == null || v === false || v === "" || v === 0) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** Allocation rows count only when some amount-like field is > 0 (empty/zero rows are not links). */
function allocationsHaveAmount(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  return v.some((a) => {
    if (!a || typeof a !== "object") return false;
    return Object.entries(a as Record<string, unknown>).some(
      ([k, x]) => /amount|allocated|total|paid/i.test(k) && Number(x) > 0
    );
  });
}

/** Inter-company, linked, recurring, allocations (with amount) => doubt (keep today's behaviour). */
export function docHasCrossLinkFields(data: Record<string, unknown> | null | undefined): boolean {
  if (!data || typeof data !== "object") return false;
  for (const [k, v] of Object.entries(data)) {
    if (CROSS_LINK_KEY_RE.test(k) && nonEmpty(v)) return true;
    if (k === "allocations" && allocationsHaveAmount(v)) return true;
    if (k === "openingBalanceAllocated" && nonEmpty(v)) return true;
  }
  return false;
}

/** `companies/<cid>/<coll>/<id>` match (pending file docPath). */
export function pendingDocPathMatches(docPath: string, collectionName: string, docId: string): boolean {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(docPath || "").trim());
  return Boolean(m && m[2] === collectionName && m[3] === docId);
}

/**
 * Push "local" count: distinct queue rows (pending+failed+paused, all collections)
 * + pending files whose target doc is not already in the queue. No notOnOnline add.
 */
export function computePushLocalCount(
  queueRows: Array<{ outboxId: string; collectionName: string; docId: string }>,
  pendingFiles: Array<{ id: string; docPath?: string }>
): number {
  const rowIds = new Set<string>();
  const docKeys = new Set<string>();
  for (const r of queueRows) {
    if (!r?.outboxId) continue;
    rowIds.add(r.outboxId);
    docKeys.add(`${r.collectionName}/${r.docId}`);
  }
  const fileIds = new Set<string>();
  for (const f of pendingFiles) {
    if (!f?.id || fileIds.has(f.id)) continue;
    const m = /^companies\/[^/]+\/([^/]+)\/([^/]+)$/.exec(String(f.docPath || "").trim());
    if (m && docKeys.has(`${m[1]}/${m[2]}`)) continue;
    fileIds.add(f.id);
  }
  return rowIds.size + fileIds.size;
}
