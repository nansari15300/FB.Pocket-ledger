"use client";

/**
 * One-click "Sync now" for the app header (and Force upload for PocketBase companies).
 *
 * PocketBase (Pocket Ledger Server) companies: INCREMENTAL only.
 *   - Everything that is already confirmed on the server is left alone (no full read, no full write).
 *   - Work list = outbox rows (sync_outbox), docs that still carry uploadable `local:` file refs and have
 *     no outbox row, and a dirty company root. If that list is empty: "Already in sync", zero network.
 *   - Pushing goes through the normal outbox flush (`pushOutboxRowToPocketBase`), which also uploads files.
 *   - Never touches Firestore (except the single dirty-root push that already exists in pbSync) and never
 *     calls `triggerSync` (that rebinds every listener = extra reads).
 * Other (Firebase) companies: cheap pending check first, then the existing force upload.
 */

import {
  canSyncCompanyToServer,
  countSyncOutboxRowsForCompany,
  flushVoucherOutbox,
  getOutboxStatusCounts,
  requeueFailedOutboxRows,
  requeueLocalDocsToOutbox,
} from "@/lib/localVoucherOutbox";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { getBrowserDbForCompanyId } from "@/lib/localSqlite";
import { listCompanyDocRawRowsWithLocalRefHint } from "@/lib/localCompanyDocMirror";
import { countPendingFilesForCompany, getPendingPayloadForLocalRef } from "@/lib/localPendingFiles";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import { isPocketBaseAppSessionActive } from "@/lib/pocketbaseData/pbAppSession";
import { clearPbOutboxCompanyBlock, getPbOutboxCompanyBlock } from "@/lib/pocketbaseData/pbOutboxBlock";
import { yieldToMain } from "@/lib/yieldToMain";

export type SyncNowStatus =
  | "in_sync"
  | "synced"
  | "partial"
  | "offline"
  | "signed_out"
  | "not_syncable"
  | "error";

export type SyncNowProgress = {
  phase: string;
  done: number;
  total: number;
  detail?: string;
};

export type SyncCompanyNowResult = {
  status: SyncNowStatus;
  /** true = PocketBase incremental path, false = Firebase path (existing force upload). */
  pb: boolean;
  /** Outbox rows (records) the server accepted in this run. */
  pushed: number;
  /** Outbox rows that failed in this run. */
  failed: number;
  /** Outbox rows still waiting after the run. */
  remaining: number;
  /** Docs with `local:` file refs whose bytes ARE on this device, queued again this run. */
  filesQueued: number;
  /** Docs/refs whose file bytes are NOT on this device (cannot be uploaded from here). */
  stuckFiles: number;
  rootPushed: boolean;
  message: string;
  /** The last finished result was reused (3 s cooldown), nothing ran. */
  cooldownSkipped?: boolean;
};

export type DocRef = { coll: string; id: string };

const COOLDOWN_MS = 3000;
const BACKOFF_RESET_MIN_GAP_MS = 30_000;
const MAX_FLUSH_ROUNDS = 8;
const REQUEUE_CHUNK = 100;

const inFlight = new Map<string, Promise<SyncCompanyNowResult>>();
const lastDone = new Map<string, { at: number; result: SyncCompanyNowResult }>();
const lastBackoffReset = new Map<string, number>();

export function isCompanySyncInFlight(companyId: string): boolean {
  return inFlight.has(companyId);
}

/** Cheap badge number: outbox rows of this company in local SQLite (one COUNT query). */
export async function countPendingSyncItems(companyId: string): Promise<number> {
  return countSyncOutboxRowsForCompany(companyId);
}

function walkLocalRefs(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 24 || value == null) return;
  if (typeof value === "string") {
    if (value.startsWith("local:") && value.length > 6) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walkLocalRefs(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) walkLocalRefs(v, out, depth + 1);
  }
}

/**
 * Docs that still hold `local:` refs and have no outbox row.
 * SQL `LIKE '%local:%'` returns only matching rows (no full collection parse).
 * uploadable = at least one ref has its bytes on this device; stuck = refs without bytes.
 */
export async function scanDocsWithLocalRefs(companyId: string): Promise<{
  uploadable: DocRef[];
  stuckDocs: number;
}> {
  const uploadable: DocRef[] = [];
  let stuckDocs = 0;
  const db = await getBrowserDbForCompanyId(companyId);
  if (!db) return { uploadable, stuckDocs };
  const { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } = await import("@/lib/firestoreToLocalCompanyPull");
  for (const coll of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
    const rows = await listCompanyDocRawRowsWithLocalRefHint(companyId, companyId, coll);
    if (!rows.length) continue;
    let queued = new Set<string>();
    try {
      const q = db
        .prepare(`SELECT doc_id FROM sync_outbox WHERE company_id = ? AND collection_name = ?`)
        .all(companyId, coll) as Array<{ doc_id?: string }>;
      queued = new Set(q.map((r) => String(r.doc_id || "")));
    } catch {
      queued = new Set();
    }
    for (const row of rows) {
      if (queued.has(row.id)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        continue;
      }
      if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).isDeleted === true) continue;
      const refs = new Set<string>();
      walkLocalRefs(parsed, refs);
      if (!refs.size) continue;
      let hasBytes = false;
      for (const ref of refs) {
        try {
          const item = await getPendingPayloadForLocalRef(ref);
          if (item?.blob && item.blob.size > 0) {
            hasBytes = true;
            break;
          }
        } catch {
          /* treat as missing */
        }
      }
      if (hasBytes) uploadable.push({ coll, id: row.id });
      else stuckDocs++;
    }
    await yieldToMain();
  }
  return { uploadable, stuckDocs };
}

/**
 * Bounded flush of this company's outbox: stops when empty, when a round made no progress,
 * or after MAX_FLUSH_ROUNDS. Rows in server backoff are skipped by the flush itself (no request).
 */
export async function flushPbOutboxForCompany(
  companyId: string,
  onProgress?: (p: SyncNowProgress) => void
): Promise<{ ok: number; failed: number; remaining: number }> {
  let ok = 0;
  let failed = 0;
  const initial = await countSyncOutboxRowsForCompany(companyId);
  let remaining = initial;
  for (let round = 0; round < MAX_FLUSH_ROUNDS && remaining > 0; round++) {
    const res = await flushVoucherOutbox({ only: { companyId } });
    ok += res.ok;
    failed = res.failed;
    const now = await countSyncOutboxRowsForCompany(companyId);
    onProgress?.({
      phase: "Uploading changes",
      done: Math.max(0, initial - now),
      total: Math.max(1, initial),
    });
    const progressed = now < remaining;
    remaining = now;
    if (res.ok === 0 || !progressed) break;
    await yieldToMain();
  }
  return { ok, failed, remaining };
}

async function runPocketBaseIncremental(
  cid: string,
  onProgress?: (p: SyncNowProgress) => void
): Promise<SyncCompanyNowResult> {
  const base: SyncCompanyNowResult = {
    status: "in_sync",
    pb: true,
    pushed: 0,
    failed: 0,
    remaining: 0,
    filesQueued: 0,
    stuckFiles: 0,
    rootPushed: false,
    message: "",
  };

  // 1) cheap local assessment (SQLite only, zero network)
  onProgress?.({ phase: "Checking what is pending", done: 0, total: 1 });
  const counts = await getOutboxStatusCounts(cid);
  const { isPocketBaseCompanyRootDirty } = await import("@/lib/pocketbaseData/pbSync");
  const rootDirty = isPocketBaseCompanyRootDirty(cid) && !isPocketBaseAppSessionActive();
  const refs = await scanDocsWithLocalRefs(cid);
  const pendingWork = counts.total + refs.uploadable.length + (rootDirty ? 1 : 0);
  base.stuckFiles = refs.stuckDocs;
  base.remaining = counts.total;

  if (pendingWork === 0) {
    return {
      ...base,
      status: "in_sync",
      message: refs.stuckDocs
        ? `Already in sync. ${refs.stuckDocs} record(s) have file(s) whose bytes are not on this device.`
        : "Already in sync. Nothing was sent.",
    };
  }

  // 2) gates
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      ...base,
      status: "offline",
      message: `You are offline. ${pendingWork} change(s) stay queued and will sync when you are back online.`,
    };
  }
  if (!getValidPocketBaseAuth()) {
    return {
      ...base,
      status: "signed_out",
      message: "Not signed in to Pocket Ledger Server. Sign in again, then press Sync.",
    };
  }

  // 3) manual retry: lift company block / failed state (rate-limited so a double tap cannot hammer the server)
  const needsRetryReset =
    counts.failed + counts.paused > 0 || !!getPbOutboxCompanyBlock(cid);
  if (needsRetryReset) {
    const last = lastBackoffReset.get(cid) ?? 0;
    if (Date.now() - last >= BACKOFF_RESET_MIN_GAP_MS) {
      lastBackoffReset.set(cid, Date.now());
      await requeueFailedOutboxRows(cid);
      clearPbOutboxCompanyBlock();
    }
  }

  // 4) docs with uploadable local: refs and no outbox row: queue only those docs
  let filesQueued = 0;
  if (refs.uploadable.length) {
    onProgress?.({ phase: "Queueing files", done: 0, total: refs.uploadable.length });
    for (let i = 0; i < refs.uploadable.length; i += REQUEUE_CHUNK) {
      const chunk = refs.uploadable.slice(i, i + REQUEUE_CHUNK).map((d) => ({ collectionName: d.coll, docId: d.id }));
      filesQueued += await requeueLocalDocsToOutbox(cid, chunk);
      onProgress?.({
        phase: "Queueing files",
        done: Math.min(refs.uploadable.length, i + chunk.length),
        total: refs.uploadable.length,
      });
      await yieldToMain();
    }
  }

  // 5) bounded flush of this company's outbox
  const flush = await flushPbOutboxForCompany(cid, onProgress);

  // 6) dirty root: one push
  let rootPushed = false;
  if (rootDirty) {
    onProgress?.({ phase: "Company profile", done: 0, total: 1 });
    try {
      const { pbPushCompanyRootFromFirestore } = await import("@/lib/pocketbaseData/pbSync");
      await pbPushCompanyRootFromFirestore(cid);
      rootPushed = !isPocketBaseCompanyRootDirty(cid);
    } catch {
      rootPushed = false;
    }
  }

  // 7) recount (local SQLite only) + stuck files after the run
  const remaining = await countSyncOutboxRowsForCompany(cid);
  const after = refs.uploadable.length ? await scanDocsWithLocalRefs(cid) : null;
  const stuckFiles = after ? after.stuckDocs + after.uploadable.length : refs.stuckDocs;
  const rootStillDirty = rootDirty && !rootPushed;

  const parts: string[] = [];
  if (flush.ok > 0) parts.push(`${flush.ok} record(s) sent`);
  if (rootPushed) parts.push("company profile sent");
  const warn: string[] = [];
  if (remaining > 0) warn.push(`${remaining} still waiting (server busy / retry shortly)`);
  if (flush.failed > 0) warn.push(`${flush.failed} failed`);
  if (rootStillDirty) warn.push("company profile not sent yet");
  if (stuckFiles > 0) warn.push(`${stuckFiles} record(s) have file(s) not on this device`);

  const status: SyncNowStatus =
    remaining === 0 && !rootStillDirty
      ? parts.length
        ? "synced"
        : "in_sync"
      : parts.length
        ? "partial"
        : "error";

  const message =
    parts.length || warn.length
      ? `${parts.join(", ")}${parts.length && warn.length ? ". " : ""}${warn.join("; ")}.`
      : "Already in sync. Nothing was sent.";

  return {
    status,
    pb: true,
    pushed: flush.ok,
    failed: flush.failed,
    remaining,
    filesQueued,
    stuckFiles,
    rootPushed,
    message: message.replace(/^\s+/, ""),
  };
}

/** Lock + 3 s cooldown wrapper shared by every entry point (header, Settings force upload, deep check push). */
function withLock(cid: string, fn: () => Promise<SyncCompanyNowResult>): Promise<SyncCompanyNowResult> {
  const existing = inFlight.get(cid);
  if (existing) return existing;
  const last = lastDone.get(cid);
  if (
    last &&
    Date.now() - last.at < COOLDOWN_MS &&
    last.result.remaining === 0 &&
    (last.result.status === "synced" || last.result.status === "in_sync")
  ) {
    return Promise.resolve({ ...last.result, cooldownSkipped: true });
  }
  const p = (async () => {
    try {
      const result = await fn();
      lastDone.set(cid, { at: Date.now(), result });
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        status: "error" as const,
        pb: true,
        pushed: 0,
        failed: 0,
        remaining: 0,
        filesQueued: 0,
        stuckFiles: 0,
        rootPushed: false,
        message,
      };
    } finally {
      inFlight.delete(cid);
    }
  })();
  inFlight.set(cid, p);
  return p;
}

/** PocketBase incremental sync (locked). Used by the header and by force upload for PB companies. */
export function syncPocketBaseCompanyNow(
  companyId: string,
  opts?: { onProgress?: (p: SyncNowProgress) => void }
): Promise<SyncCompanyNowResult> {
  const cid = String(companyId || "").trim();
  if (!cid) {
    return Promise.resolve({
      status: "not_syncable",
      pb: true,
      pushed: 0,
      failed: 0,
      remaining: 0,
      filesQueued: 0,
      stuckFiles: 0,
      rootPushed: false,
      message: "No company selected.",
    });
  }
  return withLock(cid, () => runPocketBaseIncremental(cid, opts?.onProgress));
}

/** Header entry point. PB -> incremental; other companies -> pending check, then existing force upload. */
export function syncCompanyNow(
  companyId: string,
  opts?: { onProgress?: (p: SyncNowProgress) => void }
): Promise<SyncCompanyNowResult> {
  const cid = String(companyId || "").trim();
  const emptyNotSyncable: SyncCompanyNowResult = {
    status: "not_syncable",
    pb: false,
    pushed: 0,
    failed: 0,
    remaining: 0,
    filesQueued: 0,
    stuckFiles: 0,
    rootPushed: false,
    message: "This company is device-only (not configured for server sync).",
  };
  if (!cid) return Promise.resolve({ ...emptyNotSyncable, message: "No company selected." });
  return withLock(cid, async () => {
    const reg = await getLocalCompanyById(cid, { includeDeleted: true });
    if (isPocketBaseCompany(cid, reg)) {
      return runPocketBaseIncremental(cid, opts?.onProgress);
    }
    if (!(await canSyncCompanyToServer(cid))) return emptyNotSyncable;
    const counts = await getOutboxStatusCounts(cid);
    const pendingFiles = await countPendingFilesForCompany(cid);
    const refs = await scanDocsWithLocalRefs(cid);
    const pendingWork = counts.total + pendingFiles + refs.uploadable.length;
    if (pendingWork === 0) {
      return {
        ...emptyNotSyncable,
        status: "in_sync" as const,
        stuckFiles: refs.stuckDocs,
        message: "Already in sync. Nothing was sent.",
      };
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return {
        ...emptyNotSyncable,
        status: "offline" as const,
        remaining: counts.total,
        message: `You are offline. ${pendingWork} change(s) stay queued and will sync when you are back online.`,
      };
    }
    const { forceUploadLocalCompanyToServer } = await import("@/lib/forceUploadLocalCompanyToServer");
    const r = await forceUploadLocalCompanyToServer(cid, {
      onProgress: (p) => opts?.onProgress?.({ phase: p.phase, done: p.done, total: p.total, detail: p.detail }),
    });
    const remaining = await countSyncOutboxRowsForCompany(cid);
    const sent = r.docsPushed + r.outboxFlushed + r.filesSynced + r.localRefsRelinked;
    const ok = r.ok && remaining === 0 && r.localRefsStillStuck === 0;
    return {
      status: ok ? (sent > 0 ? ("synced" as const) : ("in_sync" as const)) : sent > 0 ? ("partial" as const) : ("error" as const),
      pb: false,
      pushed: r.outboxFlushed + r.docsPushed,
      failed: r.outboxFailed + r.filesFailed,
      remaining,
      filesQueued: r.localRefsRequeued,
      stuckFiles: r.localRefsStillStuck,
      rootPushed: false,
      message:
        r.message ||
        (sent > 0
          ? `${r.docsPushed} record(s) pushed, ${r.filesSynced} file(s) uploaded${r.localRefsStillStuck ? `, ${r.localRefsStillStuck} file(s) not on this device` : ""}.`
          : "Already in sync. Nothing was sent."),
    };
  });
}