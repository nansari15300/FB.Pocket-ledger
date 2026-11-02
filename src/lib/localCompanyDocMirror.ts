"use client";

/**
 * Firestore → browser SQLite (`company_docs`) best-effort mirror.
 * After each successful outbox flush, refresh local rows so masters and vouchers match the server snapshot
 * (timestamps, hydrated attachment URLs).
 *
 * Sync / download (local-first):
 * - Firestore → SQLite: `firestoreToLocalCompanyPull.pullCompanySubcollectionFromFirestoreToLocalDb` (prefetch) +
 *   `onSnapshot` → `mirrorCollectionDocsToBrowserDbSilent` (static bundle: UI reads via `listCompanyDocsFromBrowserDb`, e.g. `useVouchers`).
 * - Offline reads: `listCompanyDocsFromBrowserDb` (prefetch when the network is bad or data is already cached).
 * - Writes: local SQLite + outbox (`localVoucherOutbox`) → Firestore flush when online (`writeEntity` static path).
 */

import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { adoptServerAttachmentRefsOverLocal } from "@/lib/mirrorAttachmentRefAdopt";
import { doc, getDoc, Timestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import { clearBrowserDbCache, getBrowserDbForCompanyId } from "@/lib/localSqlite";
import { yieldToMain } from "@/lib/yieldToMain";
import { isLocalOnlyMode } from "@/lib/localMode";
import { apkEmbeddedSqliteFirstWritesPreferred } from "@/lib/apkOnlineFirestoreWritePolicy";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { companyRowUsesSqliteLedgerWrites } from "@/lib/companyStorageKind";
import { companyStrategyUsesSqliteFirstLedgerWrites } from "@/lib/staticAttachmentDisplayUrl";
import { isOnlineCompanyLedgerCloudSyncAllowed } from "@/lib/onlineCompanySelectorSyncPolicy";
import { decryptFirestoreCompanyDocIfNeeded, isEncryptedServerBackupDoc } from "@/lib/serverBackupEncryption";
import { PL_CLIENT_OFFLINE_FIRST_PERSIST_MS, stampLocalMirrorBackedByFirestore } from "@/lib/localMirrorServerMeta";
import { assertCompanyAllowsLedgerMutations } from "@/lib/security/offlinePlanWriteGate";
import {
  isPlServerLivePullPaused,
  isPlServerDeltaDocPushPending,
  maybeQueuePlServerDeltaAfterDocWrite,
} from "@/lib/plServerClientDeltaSync";
import { mirrorMergeSkipLog, serverTimestampTraceLog } from "@/lib/plServerLivePullDevLog";
import { plPhase1bVerifyHook } from "@/lib/phase1bVerifyCapture";

/** Notify UI/listeners that local `company_docs` changed (static / APK / Electron). */
export const BROWSER_DB_COLLECTION_BUMP = "pocket-ledger-browser-db-bump";

export type BrowserDbCollectionBumpDetail = {
  companyId: string;
  collection: string;
  /** User save / refresh: debounce skip — ledger turant merge. */
  immediate?: boolean;
  source?: "local_write" | "pl_host_remote_write" | "pl_server_pull" | "firebase_delta_pull" | string;
};

/** After a Firestore-backed write mirror, allow lists to refresh (same tab). */
export function notifyBrowserDbCollectionUpdated(
  companyId: string,
  collectionName: string,
  options?: { immediate?: boolean; source?: BrowserDbCollectionBumpDetail["source"] }
): void {
  if (typeof window === "undefined" || !companyId || !collectionName) return;
  const detail: BrowserDbCollectionBumpDetail = {
    companyId,
    collection: collectionName,
    immediate: options?.immediate === true,
    source: options?.source,
  };
  void import("@/lib/plServerLiveChangeTrace")
    .then(({ plServerLiveChangeTrace }) =>
      plServerLiveChangeTrace("collection_bump_dispatch", {
        companyId,
        collection: collectionName,
        immediate: detail.immediate === true,
        source: detail.source ?? "local_write",
      })
    )
    .catch(() => undefined);
  try {
    const bridge = (
      window as Window & {
        plElectronGate?: {
          publishBrowserDbCollectionBump?: (payload: BrowserDbCollectionBumpDetail) => void;
        };
      }
    ).plElectronGate;
    bridge?.publishBrowserDbCollectionBump?.(detail);
  } catch {
    /* optional IPC */
  }
  window.dispatchEvent(
    new CustomEvent<BrowserDbCollectionBumpDetail>(BROWSER_DB_COLLECTION_BUMP, {
      detail,
    })
  );
}

/**
 * When to persist into SQLite `company_docs`: web "Local" data source, or embedded (Capacitor/static) wherever
 * `enqueueCompanyDocOutbox` / flush runs. If this is false, upserts are skipped and queued server writes
 * no longer line up with on-device lists (keep in sync with `VoucherOutboxFlushManager` scheduling).
 */
function shouldMirrorToBrowserDb(): boolean {
  return isLocalOnlyMode() || apkEmbeddedSqliteFirstWritesPreferred();
}

/** Pure-local + Drive sync: SQLite mirror band ho to bhi delta queue ke liye likho (web Firebase mode fix). */
async function shouldPersistCompanyDocToBrowserDb(
  companyId: string,
  options?: UpsertCompanyBrowserOptions
): Promise<boolean> {
  if (options?.force === true) return true;
  // Thin staff: user-side SQLite mirror (online company jaisa) — persist allowed.
  const { isPlServerThinStaffCompany } = await import("@/lib/plServerThinStaffClient");
  if (await isPlServerThinStaffCompany(companyId)) return true;
  if (shouldMirrorToBrowserDb()) return true;
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  // Pocket Ledger Server (PocketBase) companies: SQLite is the local copy the UI reads and the outbox pushes from.
  if (isPocketBaseCompanyId(cid)) return true;
  try {
    const row = await getLocalCompanyById(cid, { includeDeleted: true });
    // `writeEntity` local-first se align — strategy SQLite-first ho to persist skip mat karo
    if (row && companyStrategyUsesSqliteFirstLedgerWrites(row as Parameters<typeof companyStrategyUsesSqliteFirstLedgerWrites>[0])) {
      return true;
    }
    if (row && companyRowUsesSqliteLedgerWrites(row)) return true;
    if (!isOnlineCompanyLedgerCloudSyncAllowed(cid, row ?? null)) return true;
  } catch {
    /* SQLite unavailable */
  }
  return false;
}

/** Read gate — upsert jahan allowed hai wahi par SQLite se padho (local + Drive web mode). */
async function canReadCompanyDocsFromBrowserDb(
  companyId: string,
  options?: { forBackupMerge?: boolean }
): Promise<boolean> {
  if (options?.forBackupMerge) return true;
  const { isPlServerThinStaffCompany } = await import("@/lib/plServerThinStaffClient");
  if (await isPlServerThinStaffCompany(companyId)) return true;
  if (shouldMirrorToBrowserDb()) return true;
  return shouldPersistCompanyDocToBrowserDb(companyId);
}

/** Local write ke baad Drive delta queue — `cloud_sync_outbox` (Firestore outbox alag). */
async function enqueueCloudSyncDeltaAfterMirrorWrite(input: {
  companyId: string;
  collectionName: string;
  docId: string;
  data: Record<string, unknown>;
  skipCloudSyncEnqueue?: boolean;
}): Promise<void> {
  if (input.skipCloudSyncEnqueue) return;
  const { maybeEnqueueLocalCloudSyncFromWrite } = await import("@/lib/localCloudSync/enqueueFromWrite");
  await maybeEnqueueLocalCloudSyncFromWrite({
    companyId: input.companyId,
    collectionName: input.collectionName,
    docId: input.docId,
    data: input.data,
  });
  const { scheduleLocalCloudSyncInBackground } = await import("@/lib/localCloudSync/engine");
  scheduleLocalCloudSyncInBackground(input.companyId, { force: true });
  plPhase1bVerifyHook("onCloudEnqueue");
}

const MIRROR_SQLITE_ERROR_WINDOW_MS = 30_000;
const MIRROR_SQLITE_ERROR_BURST_LIMIT = 15;
let mirrorSqliteErrorWindowStartMs = 0;
let mirrorSqliteErrorCount = 0;
let mirrorWritesTemporarilyDisabledUntilMs = 0;

function isSqliteBadParamError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
  return message.includes("bad parameter") || message.includes("api misuse");
}

function shouldSkipMirrorWritesNow(): boolean {
  // During an error storm, pause mirror writes to avoid UI freezes and log spam.
  return Date.now() < mirrorWritesTemporarilyDisabledUntilMs;
}

function markMirrorSqliteErrorAndMaybePauseWrites(error: unknown): void {
  const now = Date.now();
  if (now - mirrorSqliteErrorWindowStartMs > MIRROR_SQLITE_ERROR_WINDOW_MS) {
    mirrorSqliteErrorWindowStartMs = now;
    mirrorSqliteErrorCount = 0;
  }
  mirrorSqliteErrorCount += 1;
  if (mirrorSqliteErrorCount >= MIRROR_SQLITE_ERROR_BURST_LIMIT) {
    // Avoid tight loops on repeated sqlite misuse; 60s cool-down keeps the app responsive.
    mirrorWritesTemporarilyDisabledUntilMs = now + 60_000;
    console.warn("[localCompanyDocMirror] temporarily disabling browser-db mirror writes after repeated SQLite errors", error);
    mirrorSqliteErrorCount = 0;
    mirrorSqliteErrorWindowStartMs = now;
  }
}

/** Row delete: optional `force` after a Firestore wipe to prevent merge ghosts even when the default mirror path is off. */
function shouldApplyBrowserCompanyDocMutation(force?: boolean): boolean {
  if (force === true && typeof window !== "undefined") return true;
  return shouldMirrorToBrowserDb();
}

/** Wire/JSON Timestamp shape — `JSON.stringify(Timestamp)` drops `__fsTs` / `toDate`. */
function plainFirestoreTimestampParts(
  value: Record<string, unknown>
): { seconds: number; nanoseconds: number } | null {
  const secRaw = value.seconds ?? value._seconds;
  const nsRaw = value.nanoseconds ?? value._nanoseconds ?? 0;
  if (typeof secRaw !== "number" || !Number.isFinite(secRaw)) return null;
  if (typeof nsRaw !== "number" || !Number.isFinite(nsRaw)) return null;
  const keys = Object.keys(value);
  // Only timestamp-like bags — avoid mistaking unrelated `{ seconds: n, … }` payloads.
  const allowed = new Set(["seconds", "nanoseconds", "_seconds", "_nanoseconds", "__fsTs", "type"]);
  if (!keys.every((k) => allowed.has(k))) return null;
  return { seconds: secRaw, nanoseconds: nsRaw };
}

/**
 * Deserialize local JSON into Firestore-compatible values (Timestamp + nested).
 * Also revives plain `{seconds,nanoseconds}` from plserver HTTP JSON (no `__fsTs`).
 */
export function deserializeLocalDbValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(deserializeLocalDbValue);
  if (typeof value === "object") {
    const o = value as Record<string, unknown> & { __fsTs?: boolean; seconds?: number; nanoseconds?: number };
    if (o.__fsTs === true && typeof o.seconds === "number") {
      const ns = typeof o.nanoseconds === "number" ? o.nanoseconds : 0;
      return Timestamp.fromMillis(o.seconds * 1000 + Math.floor(ns / 1e6));
    }
    const plainTs = plainFirestoreTimestampParts(o);
    if (plainTs) {
      return Timestamp.fromMillis(plainTs.seconds * 1000 + Math.floor(plainTs.nanoseconds / 1e6));
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      out[k] = deserializeLocalDbValue(o[k]);
    }
    return out;
  }
  return value;
}

type VoucherProjectionRow = {
  id: string;
  type?: string;
  date?: Date | null;
  amount?: number;
};

/**
 * Read one company subcollection document from browser SQLite (read-only cache); web bundle may skip sql.js.
 * Typical use: invoice voucher fallback on static builds.
 */
export async function getCompanyDocFromBrowserDb(
  companyId: string,
  collectionName: string,
  docId: string,
  /** Recycle bin view: deleted rows bhi SQLite mirror se padh sakte hain. */
  opts?: { includeDeleted?: boolean; /** Merge/write paths must not treat display cache as a durable SQLite row. */ sqliteOnly?: boolean }
): Promise<Record<string, unknown> | null> {
  if (typeof window === "undefined" || !companyId || !collectionName || !docId) return null;
  if (!(await canReadCompanyDocsFromBrowserDb(companyId))) return null;
  // Thin staff: SQLite-first (mirror). Display cache only if SQLite miss (migration / cold).
  const { isPlServerThinStaffCompany } = await import("@/lib/plServerThinStaffClient");
  const thinStaff = await isPlServerThinStaffCompany(companyId);
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (db) {
      const row = db
        .prepare("SELECT id, data FROM company_docs WHERE company_id = ? AND collection = ? AND id = ?")
        .get(companyId, collectionName, docId) as { id: string; data: string } | undefined;
      if (row?.data) {
        const parsed = JSON.parse(row.data) as Record<string, unknown>;
        const data = deserializeLocalDbValue(parsed) as Record<string, unknown>;
        if (!opts?.includeDeleted && data.isDeleted === true) return null;
        return { ...data, id: row.id };
      }
    }
  } catch {
    /* fall through */
  }
  if (opts?.sqliteOnly) return null;
  if (thinStaff) {
    const { getPlServerDisplayCacheDoc, ensurePlServerDisplayCacheCollection, hydratePlServerDisplayCacheFromIdb } =
      await import("@/lib/plServerDisplayCache");
    let hit = getPlServerDisplayCacheDoc(companyId, collectionName, docId, {
      includeDeleted: opts?.includeDeleted,
    });
    if (!hit) {
      await hydratePlServerDisplayCacheFromIdb(companyId, collectionName);
      hit = getPlServerDisplayCacheDoc(companyId, collectionName, docId, {
        includeDeleted: opts?.includeDeleted,
      });
    }
    if (!hit && typeof navigator !== "undefined" && navigator.onLine) {
      await ensurePlServerDisplayCacheCollection(companyId, collectionName);
      hit = getPlServerDisplayCacheDoc(companyId, collectionName, docId, {
        includeDeleted: opts?.includeDeleted,
      });
    }
    return hit;
  }
  return null;
}

/**
 * Offline/static: avoid hanging `getDocs(where voucherNumber + type))` — scan the SQLite `company_docs` mirror for duplicates.
 * Payment In/Out hot path: avoid indefinite Firestore waits in airplane mode on APK.
 */
export async function findVoucherInLocalMirrorByNumberAndType(
  companyId: string,
  voucherNumber: string,
  voucherType: string
): Promise<{ id: string } | null> {
  if (typeof window === "undefined" || !companyId) return null;
  try {
    const rows = await listCompanyDocsFromBrowserDb(companyId, "vouchers");
    const vn = String(voucherNumber ?? "").trim();
    const vt = String(voucherType ?? "").trim();
    const hit = rows.find(
      (r: any) => String(r?.voucherNumber ?? "").trim() === vn && String(r?.type ?? "").trim() === vt
    );
    if (!hit?.id) return null;
    return { id: String(hit.id) };
  } catch {
    return null;
  }
}

/**
 * Cheap row count for health/diagnostics — no JSON.parse of every doc
 * (full `listCompanyDocsFromBrowserDb` for vouchers freezes UI ~5–15s).
 */
export async function countCompanyDocsInBrowserDb(
  companyId: string,
  collectionName: string
): Promise<number> {
  if (typeof window === "undefined" || !companyId || !collectionName) return 0;
  if (!(await canReadCompanyDocsFromBrowserDb(companyId))) return 0;
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return 0;
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM company_docs WHERE company_id = ? AND collection = ?"
      )
      .get(companyId, collectionName) as { n?: number } | undefined;
    return Math.max(0, Number(row?.n) || 0);
  } catch {
    return 0;
  }
}

export async function listCompanyDocsFromBrowserDb(
  companyId: string,
  collectionName: string,
  /** Backup merge / recycle-bin duplicate flows: include soft-deleted rows. */
  options?: { forBackupMerge?: boolean; includeSoftDeleted?: boolean }
): Promise<any[]> {
  if (typeof window === "undefined" || !companyId || !collectionName) return [];
  if (!(await canReadCompanyDocsFromBrowserDb(companyId, options))) return [];
  const { isPlServerThinStaffCompany } = await import("@/lib/plServerThinStaffClient");
  const thinStaff = await isPlServerThinStaffCompany(companyId);
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (db) {
      const rows = db
        .prepare("SELECT id, data FROM company_docs WHERE company_id = ? AND collection = ?")
        .all(companyId, collectionName) as Array<{ id: string; data: string }>;
      const out: any[] = [];
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data) as Record<string, unknown>;
          const data = deserializeLocalDbValue(parsed) as Record<string, unknown>;
          if (!options?.includeSoftDeleted && !options?.forBackupMerge && data.isDeleted === true) {
            continue;
          }
          out.push({ ...data, id: row.id });
        } catch {
          /* skip bad row */
        }
      }
      // Mirror-first for full local SQLite. Thin staff hub/web: empty SQLite → display cache (delta skip path).
      if (out.length > 0 || !thinStaff) {
        return out;
      }
    }
  } catch {
    /* fall through for thin staff cache */
  }
  if (thinStaff) {
    const { listPlServerDisplayCacheDocs, ensurePlServerDisplayCacheCollection, hydratePlServerDisplayCacheFromIdb } =
      await import("@/lib/plServerDisplayCache");
    if (listPlServerDisplayCacheDocs(companyId, collectionName, options).length === 0) {
      await hydratePlServerDisplayCacheFromIdb(companyId, collectionName);
    }
    if (
      listPlServerDisplayCacheDocs(companyId, collectionName, options).length === 0 &&
      typeof navigator !== "undefined" &&
      navigator.onLine
    ) {
      await ensurePlServerDisplayCacheCollection(companyId, collectionName);
    }
    return listPlServerDisplayCacheDocs(companyId, collectionName, options);
  }
  return [];
}

/**
 * Force-upload / attachment scan: sirf rows jinke JSON me `local:` ref ho — poori collection parse se bachao.
 */
export async function listCompanyDocRawRowsWithLocalRefHint(
  companyId: string,
  fsCompanyId: string,
  collectionName: string
): Promise<Array<{ id: string; data: string }>> {
  if (typeof window === "undefined" || !companyId || !collectionName) return [];
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return [];
    const sql =
      "SELECT id, data FROM company_docs WHERE company_id = ? AND collection = ? AND data LIKE '%local:%'";
    let rows = db.prepare(sql).all(companyId, collectionName) as Array<{ id: string; data: string }>;
    if (!rows.length && companyId !== fsCompanyId) {
      rows = db.prepare(sql).all(fsCompanyId, collectionName) as Array<{ id: string; data: string }>;
    }
    return rows;
  } catch {
    return [];
  }
}

/** Lightweight voucher rows for dashboard/recent UI via the projection table (cheap read). */
export async function listVoucherSummaryProjectionFromBrowserDb(
  companyId: string,
  options?: { forBackupMerge?: boolean; limit?: number }
): Promise<VoucherProjectionRow[]> {
  if (typeof window === "undefined" || !companyId) return [];
  if (!(await canReadCompanyDocsFromBrowserDb(companyId, options))) return [];
  const { isPlServerThinStaffCompany } = await import("@/lib/plServerThinStaffClient");
  if (await isPlServerThinStaffCompany(companyId)) {
    const vouchers = await listCompanyDocsFromBrowserDb(companyId, "vouchers", options);
    const mapped = vouchers.map((raw) => {
      const data = raw as Record<string, unknown>;
      const docDateMs = parseDateToMsLoose(data.date);
      return {
        id: String(data.id || ""),
        type: typeof data.type === "string" ? data.type : undefined,
        date: typeof docDateMs === "number" ? new Date(docDateMs) : null,
        amount: parseAmountLoose(data) ?? 0,
      };
    });
    if (typeof options?.limit === "number" && options.limit > 0) {
      return mapped.slice(0, Math.max(1, Math.floor(options.limit)));
    }
    return mapped;
  }
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return [];
    const raw = db
      .prepare(
        `SELECT id, doc_type, doc_date_ms, amount_value
         FROM company_docs_projection
         WHERE company_id = ? AND collection = 'vouchers'
         ORDER BY COALESCE(doc_date_ms, 0) DESC
         ${typeof options?.limit === "number" && options.limit > 0 ? "LIMIT ?" : ""}`
      )
      .all(
        ...(typeof options?.limit === "number" && options.limit > 0
          ? [companyId, Math.max(1, Math.floor(options.limit))]
          : [companyId])
      ) as Array<{
      id: string;
      doc_type?: string | null;
      doc_date_ms?: number | null;
      amount_value?: number | null;
    }>;
    return raw.map((r) => ({
      id: r.id,
      type: r.doc_type ?? undefined,
      date: typeof r.doc_date_ms === "number" ? new Date(r.doc_date_ms) : null,
      amount: typeof r.amount_value === "number" ? r.amount_value : 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Serialize Firestore snapshot values into JSON-stable form (Timestamps → portable objects).
 * Cloud sync outbox + SQLite mirror dono isi format ko share karte hain.
 */
export function serializeCompanyDocForLocalDb(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  // Files/Blobs are not stored in the SQLite JSON column — omit (parent skips keys when undefined).
  if (typeof File !== "undefined" && value instanceof File) return undefined;
  if (typeof Blob !== "undefined" && value instanceof Blob) return undefined;
  if (typeof value === "bigint") return (value as bigint).toString();
  if (value instanceof Timestamp) {
    return { __fsTs: true, seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    const d = (value as { toDate: () => Date }).toDate();
    return { __fsTs: true, seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
  }
  if (value instanceof Date) {
    return { __fsTs: true, seconds: Math.floor(value.getTime() / 1000), nanoseconds: 0 };
  }
  if (Array.isArray(value)) return (value as unknown[]).map(serializeCompanyDocForLocalDb).filter((v) => v !== undefined);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // plserver wire / Capacitor JSON: plain `{seconds,nanoseconds}` — tag `__fsTs` so round-trip stays stable.
    const plainTs = plainFirestoreTimestampParts(obj);
    if (plainTs) {
      return { __fsTs: true, seconds: plainTs.seconds, nanoseconds: plainTs.nanoseconds };
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      const v = serializeCompanyDocForLocalDb(obj[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
}

/** @deprecated internal alias */
function serializeForLocalDb(value: unknown): unknown {
  return serializeCompanyDocForLocalDb(value);
}

/** Normalize voucher `date` from Timestamp/Date/string/epoch into sortable epoch ms. */
function parseDateToMsLoose(raw: unknown): number | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof raw === "object") {
    const anyRaw = raw as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof anyRaw.toDate === "function") {
      const d = anyRaw.toDate();
      const ms = d.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof anyRaw.seconds === "number") {
      const ns = typeof anyRaw.nanoseconds === "number" ? anyRaw.nanoseconds : 0;
      const ms = anyRaw.seconds * 1000 + Math.floor(ns / 1e6);
      return Number.isFinite(ms) ? ms : null;
    }
  }
  return null;
}

/** Best-effort voucher amount: first finite number among `total` / `amount` / `grandTotal` / `netAmount`. */
function parseAmountLoose(raw: Record<string, unknown>): number | null {
  const keys = ["total", "amount", "grandTotal", "netAmount"];
  for (const k of keys) {
    const n = Number(raw[k]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Maintain a separate projection table so dashboard/recent views avoid parsing full voucher JSON. */
async function upsertVoucherProjection(
  companyId: string,
  collectionName: string,
  docId: string,
  data: Record<string, unknown>
): Promise<void> {
  if (collectionName !== "vouchers") return;
  const db = await getBrowserDbForCompanyId(companyId);
  if (!db) return;
  const docType = typeof data.type === "string" ? data.type : null;
  const docDateMs = parseDateToMsLoose(data.date);
  const amountValue = parseAmountLoose(data);
  const now = Date.now();
  db.prepare(
    `INSERT INTO company_docs_projection(company_id, collection, id, doc_type, doc_date_ms, amount_value, updatedAt)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(company_id, collection, id) DO UPDATE SET
       doc_type = excluded.doc_type,
       doc_date_ms = excluded.doc_date_ms,
       amount_value = excluded.amount_value,
       updatedAt = excluded.updatedAt`
  ).run(companyId, collectionName, docId, docType, docDateMs, amountValue, now);
}

async function deleteVoucherProjection(companyId: string, collectionName: string, docId: string): Promise<void> {
  if (collectionName !== "vouchers") return;
  const db = await getBrowserDbForCompanyId(companyId);
  if (!db) return;
  db.prepare(
    "DELETE FROM company_docs_projection WHERE company_id = ? AND collection = ? AND id = ?"
  ).run(companyId, collectionName, docId);
}

export type UpsertCompanyBrowserOptions = {
  /** default true; set false for snapshot batches */
  notify?: boolean;
  /** Backup restore / `storageOption: local` when `isLocalOnlyMode` is false — bypass mirror guard */
  force?: boolean;
  /** Firestore mirror/restore: skip paid-expiry read-only gate (server snapshot or import = trusted read). */
  skipPlanMutationGate?: boolean;
  /** Remote Google Drive apply — dubara cloud_sync_outbox mat banao */
  skipCloudSyncEnqueue?: boolean;
  /** Background Drive purge/relocate repatch — infinite loop roko */
  skipDriveAttachmentSideEffects?: boolean;
};

/** User-origin SQLite writes: JSON `lastEditedAt` / `updatedAt` bump — P2P export merge ke liye (column `updatedAt` kaafi nahi). */
function stampUserOriginCompanyDocData(
  data: Record<string, unknown>,
  opts: { shouldNotify: boolean; hasExistingRow: boolean }
): Record<string, unknown> {
  const nowMs = Date.now();
  const nowTs = Timestamp.now();
  if (!opts.shouldNotify) return data;
  if (opts.hasExistingRow) {
    const plMs = data[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS];
    return {
      ...data,
      lastEditedAt: nowTs,
      updatedAt: nowTs,
      [PL_CLIENT_OFFLINE_FIRST_PERSIST_MS]:
        typeof plMs === "number" && Number.isFinite(plMs) ? plMs : nowMs,
    };
  }
  if (!opts.hasExistingRow) {
    const plBump =
      data[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS] == null
        ? ({ [PL_CLIENT_OFFLINE_FIRST_PERSIST_MS]: nowMs } as Record<string, unknown>)
        : {};
    if (mirrorDocEditTimeMs(data) <= 0) {
      return { ...data, ...plBump, lastEditedAt: nowTs, updatedAt: nowTs };
    }
    // First insert: caller ne sirf createdAt diya ho to edit fields align karo (double-bump nahi).
    if (data.lastEditedAt == null && data.updatedAt == null) {
      const createStamp = data.createdAt ?? nowTs;
      return { ...data, ...plBump, lastEditedAt: createStamp, updatedAt: createStamp };
    }
    if (data.lastEditedAt == null || data.updatedAt == null) {
      const fallback = (data.lastEditedAt ?? data.updatedAt ?? data.createdAt ?? nowTs) as unknown;
      return {
        ...data,
        ...plBump,
        lastEditedAt: data.lastEditedAt ?? fallback,
        updatedAt: data.updatedAt ?? fallback,
      };
    }
    return Object.keys(plBump).length ? { ...data, ...plBump } : data;
  }
}

/** Before restore: clear old cached rows to avoid stale voucher merges */
export async function deleteAllCompanyDocsForCompany(companyId: string): Promise<void> {
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db || !companyId) return;
    db.prepare(`DELETE FROM company_docs WHERE company_id = ?`).run(companyId);
    // Wipe projection rows with full company_docs wipe so stale dashboard rows do not remain.
    db.prepare(`DELETE FROM company_docs_projection WHERE company_id = ?`).run(companyId);
  } catch (e) {
    console.warn("[localCompanyDocMirror] deleteAllCompanyDocsForCompany failed", companyId, e);
  }
}

export type DeleteCompanyBrowserDbOptions = {
  /** Also allow deletes on backup-merge paths, not only offline mirror (avoid stale merges after Firestore delete). */
  force?: boolean;
  notify?: boolean;
};

/** After a permanent Firestore delete, remove the same row from the SQLite mirror — avoids ghost rows from mergeRemoteSnapshot extras. */
export async function deleteCompanyDocFromBrowserDb(
  companyId: string,
  collectionName: string,
  docId: string,
  options?: DeleteCompanyBrowserDbOptions
): Promise<void> {
  // `force`: delete SQLite mirror row once the authoritative Firestore doc is gone (prevents extras-merge ghosts).
  if (!shouldApplyBrowserCompanyDocMutation(options?.force) || typeof window === "undefined" || !companyId || !collectionName || !docId) return;
  const notify = options?.notify !== false;
  if (collectionName === "vouchers") {
    void import("@/lib/plServerLiveChangeTrace")
      .then(({ plServerVoucherForensicTrace }) =>
        plServerVoucherForensicTrace("voucher_sqlite_delete_requested", {
          companyId,
          voucherId: docId,
          force: options?.force === true,
          notify,
          stack: new Error().stack?.split("\n").slice(1, 5).join(" | ") || "",
        })
      )
      .catch(() => undefined);
  }
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return;
    db.prepare("DELETE FROM company_docs WHERE company_id = ? AND collection = ? AND id = ?").run(companyId, collectionName, docId);
    await deleteVoucherProjection(companyId, collectionName, docId);
    if (notify) notifyBrowserDbCollectionUpdated(companyId, collectionName);
  } catch (e) {
    console.warn("[localCompanyDocMirror] deleteCompanyDocFromBrowserDb failed", collectionName, docId, e);
  }
}

export type PerformCompanyDocUpsertResult = {
  written: boolean;
  /** True when the target row is durably present in SQLite, including no-op unchanged writes. */
  persisted: boolean;
  stampedData: Record<string, unknown>;
  existingParsed: Record<string, unknown> | null;
};

async function runCompanyDocSqliteUpsertAndProjection(
  db: NonNullable<Awaited<ReturnType<typeof getBrowserDbForCompanyId>>>,
  companyId: string,
  collectionName: string,
  docId: string,
  stampedData: Record<string, unknown>
): Promise<void> {
  const json = JSON.stringify(serializeForLocalDb(stampedData));
  const now = Date.now();
  db.prepare(
    `INSERT INTO company_docs(company_id, collection, id, data, updatedAt)
     VALUES(?,?,?,?,?)
     ON CONFLICT(company_id, collection, id) DO UPDATE SET
       data = excluded.data,
       updatedAt = excluded.updatedAt`
  ).run(companyId, collectionName, docId, json, now);
  const sqliteRow = db
    .prepare(
      "SELECT data, updatedAt AS sqliteColumnUpdatedAt FROM company_docs WHERE company_id = ? AND collection = ? AND id = ?"
    )
    .get(companyId, collectionName, docId) as { data?: string; sqliteColumnUpdatedAt?: number } | undefined;
  let readBack: Record<string, unknown> | null = null;
  if (sqliteRow?.data) {
    try {
      const parsed = JSON.parse(sqliteRow.data) as Record<string, unknown>;
      readBack = deserializeLocalDbValue(parsed) as Record<string, unknown>;
    } catch {
      readBack = null;
    }
  }
  traceServerDocTimestampLifecycle("after_sqlite_write", companyId, collectionName, docId, readBack, {
    sqliteColumnUpdatedAt: sqliteRow?.sqliteColumnUpdatedAt ?? null,
  });
  await upsertVoucherProjection(companyId, collectionName, docId, stampedData);
}

/** SQLite mutation only: stamp, existing-row lookup, serialize, UPSERT, projection, retry UPSERT. */
export async function performCompanyDocUpsert(
  companyId: string,
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  options?: { shouldNotify?: boolean }
): Promise<PerformCompanyDocUpsertResult> {
  const shouldNotify = options?.shouldNotify !== false;
  const db = await getBrowserDbForCompanyId(companyId);
  if (!db) return { written: false, persisted: false, stampedData: data, existingParsed: null };

  let hasExistingRow = false;
  try {
    const existingRow = db
      .prepare("SELECT 1 AS ok FROM company_docs WHERE company_id = ? AND collection = ? AND id = ?")
      .get(companyId, collectionName, docId) as { ok?: number } | undefined;
    hasExistingRow = existingRow?.ok === 1;
  } catch {
    /* optional */
  }

  const stampedData = stampUserOriginCompanyDocData(data, { shouldNotify, hasExistingRow });
  traceServerDocTimestampLifecycle("before_upsert", companyId, collectionName, docId, stampedData);
  const json = JSON.stringify(serializeForLocalDb(stampedData));
  let existingParsed: Record<string, unknown> | null = null;
  try {
    const existing = db
      .prepare("SELECT data FROM company_docs WHERE company_id = ? AND collection = ? AND id = ?")
      .get(companyId, collectionName, docId) as { data?: string } | undefined;
    if (existing?.data === json) {
      return { written: false, persisted: true, stampedData, existingParsed: null };
    }
    if (existing?.data) {
      try {
        const parsed = JSON.parse(existing.data) as Record<string, unknown>;
        existingParsed = deserializeLocalDbValue(parsed) as Record<string, unknown>;
      } catch {
        existingParsed = null;
      }
    }
  } catch {
    /* compare optional */
  }

  try {
    await runCompanyDocSqliteUpsertAndProjection(db, companyId, collectionName, docId, stampedData);
    plPhase1bVerifyHook("onCompanyDocUpsert");
    return { written: true, persisted: true, stampedData, existingParsed };
  } catch (e) {
    if (!isSqliteBadParamError(e)) throw e;
    clearBrowserDbCache();
    const retryDb = await getBrowserDbForCompanyId(companyId);
    if (!retryDb) {
      markMirrorSqliteErrorAndMaybePauseWrites(e);
      throw e;
    }
    try {
      await runCompanyDocSqliteUpsertAndProjection(retryDb, companyId, collectionName, docId, stampedData);
      plPhase1bVerifyHook("onCompanyDocUpsert");
      return { written: true, persisted: true, stampedData, existingParsed };
    } catch (retryError) {
      markMirrorSqliteErrorAndMaybePauseWrites(retryError);
      throw retryError;
    }
  }
}

type CommitCompanyDocSideEffectOpts = {
  /** Host bridge path: main process broadcasts UI bump instead of renderer notify. */
  skipNotify?: boolean;
};

type OpeningBalanceMasterCollection =
  | "parties"
  | "bank_accounts"
  | "staff"
  | "taxes"
  | "expense_accounts";

const OPENING_BALANCE_MASTER_COLLECTIONS = new Set<string>([
  "parties",
  "bank_accounts",
  "staff",
  "taxes",
  "expense_accounts",
]);

function scheduleOpeningBalanceCapitalBalanceAfterMasterWrite(input: {
  companyId: string;
  collectionName: string;
  docId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  shouldNotify: boolean;
  skipCloudSyncEnqueue?: boolean;
}): void {
  if (!OPENING_BALANCE_MASTER_COLLECTIONS.has(input.collectionName)) return;
  if (input.collectionName === "parties" && input.docId === "opening_balance_ledger") return;

  const oldOpeningBalance = Number(input.before?.openingBalance) || 0;
  const newOpeningBalance = Number(input.after.openingBalance) || 0;
  const openingBalanceChanged =
    Object.prototype.hasOwnProperty.call(input.after, "openingBalance") &&
    Math.abs(newOpeningBalance - oldOpeningBalance) >= 0.01;
  const deletedChanged =
    Object.prototype.hasOwnProperty.call(input.after, "isDeleted") &&
    Boolean(input.before?.isDeleted) !== Boolean(input.after.isDeleted);

  if (!openingBalanceChanged && !deletedChanged) return;

  void import("@/lib/reports/systemOpeningBalanceEquityClient")
    .then(({ scheduleSystemOpeningBalanceReconcile }) =>
      scheduleSystemOpeningBalanceReconcile(input.companyId)
    )
    .catch((e) => {
      console.warn("[localCompanyDocMirror] system opening balance reconcile schedule failed", e);
    });
}

function scheduleSystemOpeningBalanceReconcileAfterMasterLifecycle(input: {
  companyId: string;
  collectionName: string;
  docId: string;
}): void {
  if (!OPENING_BALANCE_MASTER_COLLECTIONS.has(input.collectionName)) return;
  if (input.collectionName === "parties" && input.docId === "opening_balance_ledger") return;
  void import("@/lib/reports/systemOpeningBalanceEquityClient")
    .then(({ scheduleSystemOpeningBalanceReconcile }) =>
      scheduleSystemOpeningBalanceReconcile(input.companyId)
    )
    .catch((e) => {
      console.warn("[localCompanyDocMirror] system opening balance lifecycle reconcile failed", e);
    });
}

export { scheduleSystemOpeningBalanceReconcileAfterMasterLifecycle };

async function commitCompanyDocOnRenderer(
  companyId: string,
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  options?: UpsertCompanyBrowserOptions,
  sideEffectOpts?: CommitCompanyDocSideEffectOpts
): Promise<{ written: boolean; persisted: boolean; stampedData: Record<string, unknown> }> {
  const shouldNotify = options?.notify !== false;
  const mutation = await performCompanyDocUpsert(companyId, collectionName, docId, data, { shouldNotify });
  if (!mutation.written) {
    return { written: false, persisted: mutation.persisted, stampedData: mutation.stampedData };
  }

  const { stampedData, existingParsed } = mutation;

  const syncData = stampedData;

  if (
    existingParsed &&
    shouldNotify &&
    options?.skipCloudSyncEnqueue !== true &&
    options?.skipDriveAttachmentSideEffects !== true
  ) {
    void import("@/lib/localCloudSync/driveAttachmentSaveSideEffects").then(({ scheduleDriveAttachmentSideEffectsAfterDocSave }) => {
      scheduleDriveAttachmentSideEffectsAfterDocSave({
        companyId,
        collectionName,
        docId,
        before: existingParsed,
        after: syncData,
      });
    });
  }

  void enqueueCloudSyncDeltaAfterMirrorWrite({
    companyId,
    collectionName,
    docId,
    data: syncData,
    skipCloudSyncEnqueue: options?.skipCloudSyncEnqueue,
  }).catch((e) => {
    console.warn("[localCompanyDocMirror] cloud sync enqueue skipped", e);
  });

  scheduleOpeningBalanceCapitalBalanceAfterMasterWrite({
    companyId,
    collectionName,
    docId,
    before: existingParsed,
    after: syncData,
    shouldNotify,
    skipCloudSyncEnqueue: options?.skipCloudSyncEnqueue,
  });

  if (shouldNotify) {
    if (!sideEffectOpts?.skipNotify) {
      notifyBrowserDbCollectionUpdated(companyId, collectionName, { immediate: true });
      // Voucher `local:` — attachment flush first (flushOrQueue…), then delta tip. Avoid empty-file race.
      let skipImmediatePlDelta = false;
      if (collectionName === "vouchers") {
        const urls = Array.isArray(syncData.fileUrls) ? syncData.fileUrls : [];
        const hasLocalUrl = urls.some(
          (u) => typeof u === "string" && String(u).trim().startsWith("local:")
        );
        const uf = syncData.unassignedFile;
        const ufUrl =
          uf && typeof uf === "object" ? String((uf as { url?: unknown }).url || "").trim() : "";
        skipImmediatePlDelta = hasLocalUrl || ufUrl.startsWith("local:");
      }
      if (!skipImmediatePlDelta) {
        void maybeQueuePlServerDeltaAfterDocWrite(companyId, collectionName, docId, syncData);
      }
      plPhase1bVerifyHook("onMirrorQueue");
    }
  }

  // IndexedDB flush debounced (~250ms) from stmt.run — UI ko full DB export par mat roko.
  if (shouldNotify) {
    // Was: immediate flushPendingBrowserDbSave() per user-visible write = full sql.js export each time
    // (multi-second main-thread LONGTASKs per save on web). Now coalesced debounced persist; pagehide flushes.
    void import("@/lib/localSqlite").then(({ scheduleBrowserDbPersistAfterWrite }) => {
      scheduleBrowserDbPersistAfterWrite();
    });
  }

  if (shouldNotify && sideEffectOpts?.skipNotify) {
    const { maybePublishHostDeltaAfterBridgeWrite } = await import("@/lib/plServerHostDeltaPublish");
    void maybePublishHostDeltaAfterBridgeWrite(companyId, collectionName, docId, syncData);
  }

  return { written: true, persisted: true, stampedData: syncData };
}

function scheduleCompanyDocAuthoritativeDispatchAfterLocalCommit(
  companyId: string,
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  options?: UpsertCompanyBrowserOptions
): void {
  if (options?.notify === false) return;
  void import("@/lib/plServerAuthoritativeWriteRouting")
    .then(({ orchestrateCompanyDocBrowserWrite }) =>
      orchestrateCompanyDocBrowserWrite(companyId, collectionName, docId, data, options)
    )
    .catch((e) => {
      console.warn("[localCompanyDocMirror] background authoritative dispatch failed", collectionName, docId, e);
    });
}

/** Hidden bridge renderer: canonical SQLite commit without UI notify (main broadcasts bump). */
export async function hostBridgeCommitCompanyDoc(
  companyId: string,
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  options?: UpsertCompanyBrowserOptions
): Promise<{ ok: boolean; written?: boolean; error?: string }> {
  try {
    const out = await commitCompanyDocOnRenderer(companyId, collectionName, docId, data, options, {
      skipNotify: true,
    });
    return { ok: out.persisted, written: out.written, ...(out.persisted ? {} : { error: "sqlite_commit_failed" }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "commit_failed" };
  }
}

/**
 * Generic upsert into `company_docs`.
 * User-visible saves are SQLite-first; server/bridge dispatch happens after local persistence.
 * Silent mirror batches still soft-fail so Firestore/onSnapshot reads are not blocked by cache issues.
 */
export async function upsertCompanyDocInBrowserDb(
  companyId: string,
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  options?: UpsertCompanyBrowserOptions
): Promise<boolean> {
  if (!companyId || !collectionName || !docId) return false;
  const shouldNotify = options?.notify !== false;
  const { isPlServerThinStaffCompany } = await import("@/lib/plServerThinStaffClient");
  const thinStaff = await isPlServerThinStaffCompany(companyId);
  if (!thinStaff && !(await shouldPersistCompanyDocToBrowserDb(companyId, options))) return false;
  if (shouldSkipMirrorWritesNow()) {
    if (shouldNotify) throw new Error("sqlite_mirror_temporarily_paused");
    return false;
  }
  try {
    // User-origin voucher SQLite writes: expired paid / strict JWT gate — mirror/restore paths `skipPlanMutationGate`.
    if (collectionName === "vouchers" && options?.skipPlanMutationGate !== true) {
      await assertCompanyAllowsLedgerMutations(companyId);
    }

    const { recordContainsLocalPendingEntityFileRef, syncEntityAttachmentsAfterSaveAndWait } = await import(
      "@/lib/entityProfileLocalFiles"
    );
    // PL direct writes are guarded in `plServerAuthoritativeWriteRouting`; avoid a duplicate 20s best-effort wait here.
    if (collectionName !== "vouchers" && recordContainsLocalPendingEntityFileRef(data)) {
      const { shouldEnqueuePlServerAttachmentUpload } = await import("@/lib/plServerAttachmentUploadQueue");
      if (!thinStaff && !(await shouldEnqueuePlServerAttachmentUpload(companyId))) {
        void syncEntityAttachmentsAfterSaveAndWait(companyId).catch((e) => {
          console.warn("[localCompanyDocMirror] background entity attachment sync skipped", e);
        });
      }
    }

    if (thinStaff) {
      // Staff/client lane: local SQLite first, then Host/server replay in background.
      const out = await commitCompanyDocOnRenderer(companyId, collectionName, docId, data, options);
      if (out.persisted) {
        try {
          const { patchPlServerDisplayCacheDoc } = await import("@/lib/plServerDisplayCache");
          patchPlServerDisplayCacheDoc(companyId, collectionName, docId, out.stampedData);
        } catch {
          /* optional warm */
        }
        if (collectionName === "vouchers" && shouldNotify) {
          const { dispatchVoucherLivePatch } = await import("@/lib/voucherFormAttachmentSave");
          dispatchVoucherLivePatch(companyId, docId, { ...out.stampedData, id: docId });
        } else if (shouldNotify) {
          const { dispatchMasterLivePatch, isMasterLivePatchCollection } = await import(
            "@/lib/masterEntityLivePatch"
          );
          if (isMasterLivePatchCollection(collectionName)) {
            dispatchMasterLivePatch(
              companyId,
              collectionName,
              docId,
              { ...out.stampedData, id: docId },
              { insertIfMissing: true }
            );
          }
        }
        if (shouldNotify) {
          try {
            const { markPlServerLocalWrite } = await import("@/lib/plServerClientDeltaSync");
            markPlServerLocalWrite(companyId);
          } catch {
            /* optional */
          }
        }
        scheduleCompanyDocAuthoritativeDispatchAfterLocalCommit(
          companyId,
          collectionName,
          docId,
          out.stampedData,
          options
        );
        return true;
      }
      if (shouldNotify) throw new Error("sqlite_commit_failed");
      return false;
    }

    const out = await commitCompanyDocOnRenderer(companyId, collectionName, docId, data, options);
    if (out.persisted) {
      if (collectionName === "vouchers" && shouldNotify) {
        const { dispatchVoucherLivePatch } = await import("@/lib/voucherFormAttachmentSave");
        dispatchVoucherLivePatch(companyId, docId, { ...out.stampedData, id: docId });
      } else if (shouldNotify) {
        const { dispatchMasterLivePatch, isMasterLivePatchCollection } = await import(
          "@/lib/masterEntityLivePatch"
        );
        if (isMasterLivePatchCollection(collectionName)) {
          dispatchMasterLivePatch(
            companyId,
            collectionName,
            docId,
            { ...out.stampedData, id: docId },
            { insertIfMissing: true }
          );
        }
      }
      scheduleCompanyDocAuthoritativeDispatchAfterLocalCommit(
        companyId,
        collectionName,
        docId,
        out.stampedData,
        options
      );
      return true;
    }
    if (shouldNotify) throw new Error("sqlite_commit_failed");
  } catch (e) {
    if (shouldNotify || thinStaff || (e as { plAuthoritativeWriteFailed?: boolean })?.plAuthoritativeWriteFailed) {
      throw e;
    }
    console.warn("[localCompanyDocMirror] upsert failed", collectionName, docId, e);
  }
  return false;
}

/**
 * Persist a full snapshot batch from `onSnapshot` into SQLite — offline reads and invoice party/item cache.
 * Per-doc notify is off (performance / avoid event floods).
 * `cloudBackedOfflineCache`: PWA/web Firebase companies may use SQLite as a shadow cache when the default mirror guard is off.
 */
/** P2P pull: local row agar server snapshot se nayi ho to overwrite mat karo. */
export function mirrorDocEditTimeMs(row: Record<string, unknown>): number {
  for (const key of ["lastEditedAt", "updatedAt", "createdAt"] as const) {
    const raw = row[key];
    if (raw == null) continue;
    const v = deserializeLocalDbValue(raw);
    if (v instanceof Timestamp) {
      const ms = v.toMillis();
      if (Number.isFinite(ms)) return ms;
    }
    if (v instanceof Date) {
      const ms = v.getTime();
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof raw === "object" && raw !== null) {
      const o = raw as { seconds?: number; nanoseconds?: number };
      if (typeof o.seconds === "number") {
        const ns = typeof o.nanoseconds === "number" ? o.nanoseconds : 0;
        return o.seconds * 1000 + Math.floor(ns / 1e6);
      }
    }
  }
  const pl = row[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS];
  if (typeof pl === "number" && Number.isFinite(pl)) return pl;
  return 0;
}

function mirrorDocDeletedFlag(row: Record<string, unknown>): boolean {
  return row.isDeleted === true || row.deleted === true || row.movedToAdminRecycleAt != null;
}

function stableSerializedMirrorValue(value: unknown): unknown {
  const serialized = serializeCompanyDocForLocalDb(value);
  if (Array.isArray(serialized)) return serialized.map(stableSerializedMirrorValue);
  if (serialized && typeof serialized === "object") {
    const obj = serialized as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = stableSerializedMirrorValue(obj[key]);
    }
    return out;
  }
  return serialized;
}

function mirrorDocsEqualForTimestampTie(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(stableSerializedMirrorValue(a)) === JSON.stringify(stableSerializedMirrorValue(b));
  } catch {
    return false;
  }
}

export function mirrorDocTimestampFields(row: Record<string, unknown>): {
  lastEditedAt: unknown;
  updatedAt: unknown;
  createdAt: unknown;
  offlineFirstPersistMs: unknown;
  editTimeMs: number;
} {
  return {
    lastEditedAt: row.lastEditedAt,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    offlineFirstPersistMs: row[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS],
    editTimeMs: mirrorDocEditTimeMs(row),
  };
}

const SERVER_TIMESTAMP_TRACE_COLLECTIONS = new Set(["parties"]);

function traceServerDocTimestampLifecycle(
  phase: string,
  companyId: string,
  collectionName: string,
  docId: string,
  row?: Record<string, unknown> | null,
  extra?: Record<string, unknown>
): void {
  if (!SERVER_TIMESTAMP_TRACE_COLLECTIONS.has(collectionName)) return;
  serverTimestampTraceLog(phase, {
    companyId,
    collection: collectionName,
    id: docId,
    ...(row ? mirrorDocTimestampFields(row) : {}),
    ...extra,
  });
}

/** `failed`: docs that were NOT written because the SQLite write failed/paused (not an intentional merge skip). */
export type DeltaCollectionSilentResult = { upserted: number; skipped: number; failed?: number };

export async function mirrorCollectionDocsToBrowserDbSilent(
  companyId: string,
  collectionName: string,
  docs: unknown[],
  options?: {
    cloudBackedOfflineCache?: boolean;
    force?: boolean;
    mergePreferNewer?: boolean;
    /** P2P full pull: server snapshot authoritative — extras delete + empty [] allowed. */
    authoritativeSnapshot?: boolean;
    /** Push receive on server: tie par incoming (client) win. Pull par default local win. */
    mergePreferNewerTieBreak?: "local" | "incoming";
    /** P2P reconciliation: local doc newer ho to caller usko remote repair queue me bhej sake. */
    onLocalNewer?: (
      docId: string,
      localDoc: Record<string, unknown>,
      incomingDoc: Record<string, unknown>
    ) => void | Promise<void>;
  }
): Promise<DeltaCollectionSilentResult> {
  const empty: DeltaCollectionSilentResult = { upserted: 0, skipped: 0 };
  if (typeof window === "undefined" || !companyId || !collectionName || !Array.isArray(docs)) return empty;
  const authoritative = options?.authoritativeSnapshot === true;
  if (docs.length === 0 && !authoritative) return empty;
  const persistAllowed =
    shouldMirrorToBrowserDb() || options?.cloudBackedOfflineCache === true || options?.force === true;
  if (!persistAllowed) return empty;
  /** Web cloud path / P2P delta: `force` se SQLite upsert jab default mirror guard off ho. */
  const forceUpsert = options?.force === true || !shouldMirrorToBrowserDb();
  const incomingIds = new Set<string>();
  const tiePrefersLocal = options?.mergePreferNewerTieBreak !== "incoming";
  let upserted = 0;
  let skipped = 0;
  let failed = 0;
  let pendingApprovalOutboxById: Map<string, Record<string, unknown>> | null = null;
  let pendingBillWiseOutboxById: Map<string, Record<string, unknown>> | null = null;
  if (collectionName === "vouchers") {
    try {
      const { readPendingApprovalOutboxByVoucherId, readPendingBillWiseOutboxByVoucherId } = await import(
        "@/lib/localVoucherOutbox"
      );
      pendingApprovalOutboxById = await readPendingApprovalOutboxByVoucherId(companyId);
      pendingBillWiseOutboxById = await readPendingBillWiseOutboxByVoucherId(companyId);
    } catch {
      pendingApprovalOutboxById = new Map();
      pendingBillWiseOutboxById = new Map();
    }
  }
  // Unsynced local edit wins in EVERY mirror path (listener bake, pulls, prefetch): a doc with a sync_outbox row
  // (pending/failed/paused, e.g. quota hold) must never be overwritten by a stale server copy.
  let unsyncedOutboxIds: Set<string> = new Set();
  let unsyncedOutboxPayloads: Map<string, Record<string, unknown>> = new Map();
  try {
    const { readPendingOutboxPayloadsForCompany } = await import("@/lib/localVoucherOutbox");
    unsyncedOutboxPayloads = await readPendingOutboxPayloadsForCompany(companyId, collectionName);
    unsyncedOutboxIds = new Set(unsyncedOutboxPayloads.keys());
  } catch {
    unsyncedOutboxIds = new Set();
    unsyncedOutboxPayloads = new Map();
  }
  for (const row of docs) {
    const rec = row as { id?: string };
    const id = rec?.id as string | undefined;
    if (!id) {
      skipped += 1;
      mirrorMergeSkipLog({
        companyId,
        collection: collectionName,
        id: null,
        reason: "missing_id",
      });
      continue;
    }
    incomingIds.add(id);
    if (unsyncedOutboxIds.has(id)) {
      const pending = unsyncedOutboxPayloads.get(id);
      if (pending && Object.keys(pending).length > 1) {
        try {
          const existing = await getCompanyDocFromBrowserDb(companyId, collectionName, id, { sqliteOnly: true });
          const existingMs = existing ? mirrorDocEditTimeMs(existing) : 0;
          const pendingMs = mirrorDocEditTimeMs(pending);
          if (!existing || pendingMs >= existingMs) {
            await upsertCompanyDocInBrowserDb(companyId, collectionName, id, pending, { notify: false });
          }
        } catch {
          /* keep skip */
        }
      }
      skipped += 1;
      continue;
    }
    let payload = { ...(row as object), id } as Record<string, unknown>;
    if (options?.mergePreferNewer) {
      try {
        if (isPlServerDeltaDocPushPending(companyId, collectionName, id)) {
          skipped += 1;
          mirrorMergeSkipLog({
            companyId,
            collection: collectionName,
            id,
            reason: "push_pending",
            ...mirrorDocTimestampFields(payload),
            remoteDeleted: mirrorDocDeletedFlag(payload),
          });
          continue;
        }
        let existing = await getCompanyDocFromBrowserDb(companyId, collectionName, id, { sqliteOnly: true });
        // Voucher push writes `local:` first, then `pbatt:` with the same updatedAtMs.
        // That second copy must not be dropped by the timestamp tie (other device kept the voucher, lost the file).
        const voucherServerFileOnTie =
          existing && collectionName === "vouchers"
            ? adoptServerAttachmentRefsOverLocal(existing as Record<string, unknown>, payload) != null
            : false;
        if (existing && collectionName !== "vouchers") {
          // Local local: pending ref vs server pbatt: for the same slot: server ref wins even on a timestamp tie
          // (push writes local: first, then rewrites to pbatt: with the same updatedAtMs).
          const adopted = adoptServerAttachmentRefsOverLocal(existing as Record<string, unknown>, payload);
          if (adopted) {
            try {
              await upsertCompanyDocInBrowserDb(companyId, collectionName, id, adopted, {
                force: true,
                notify: true,
                skipPlanMutationGate: true,
                skipCloudSyncEnqueue: true,
              });
              existing = adopted as typeof existing;
            } catch {
              /* next pull retries */
            }
          }
        }
        if (existing) {
          const existingMs = mirrorDocEditTimeMs(existing);
          const incomingMs = mirrorDocEditTimeMs(payload);
          const localTs = mirrorDocTimestampFields(existing);
          const remoteTs = mirrorDocTimestampFields(payload);
          const incomingDeleted = mirrorDocDeletedFlag(payload);
          const existingDeleted = mirrorDocDeletedFlag(existing);
          const remoteApproveOntoLocal =
            collectionName === "vouchers" &&
            payload.isApproved === true &&
            existing.isApproved !== true;
          const voucherApprovalDiffers =
            collectionName === "vouchers" &&
            (existing.isApproved === true) !== (payload.isApproved === true);
          // Delete wins: a remote tombstone must hide the row even if local timestamps look newer.
          // Remote approve is an exception: PocketBase used to push isApproved without bumping
          // lastEditedAt, so the other device treated it as stale and kept the pink row.
          if (existingMs > incomingMs && !(incomingDeleted && !existingDeleted)) {
            if (remoteApproveOntoLocal) {
              payload = {
                ...existing,
                isApproved: true,
                approvedByUserId: payload.approvedByUserId ?? existing.approvedByUserId,
                approvedByUserName: payload.approvedByUserName ?? existing.approvedByUserName,
                approvedAt: payload.approvedAt ?? existing.approvedAt,
                approvalUpdatedAt: payload.approvalUpdatedAt ?? existing.approvalUpdatedAt,
              };
            } else {
              await options?.onLocalNewer?.(id, existing, payload);
              skipped += 1;
              mirrorMergeSkipLog({
                companyId,
                collection: collectionName,
                id,
                reason: "local_newer",
                localUpdatedAt: localTs.lastEditedAt ?? localTs.updatedAt ?? localTs.createdAt,
                remoteUpdatedAt: remoteTs.lastEditedAt ?? remoteTs.updatedAt ?? remoteTs.createdAt,
                localEditTimeMs: existingMs,
                remoteEditTimeMs: incomingMs,
                localDeleted: mirrorDocDeletedFlag(existing),
                remoteDeleted: mirrorDocDeletedFlag(payload),
                localOfflineFirstPersistMs: localTs.offlineFirstPersistMs,
                remoteOfflineFirstPersistMs: remoteTs.offlineFirstPersistMs,
              });
              continue;
            }
          }
          const livePullPaused = isPlServerLivePullPaused(companyId);
          const incomingWinsTimestampTie = options?.mergePreferNewerTieBreak === "incoming";
          if (
            existingMs === incomingMs &&
            incomingWinsTimestampTie &&
            mirrorDocsEqualForTimestampTie(existing, payload) &&
            !voucherApprovalDiffers
          ) {
            skipped += 1;
            if (collectionName === "vouchers") {
              await upsertVoucherProjection(companyId, collectionName, id, payload);
            }
            mirrorMergeSkipLog({
              companyId,
              collection: collectionName,
              id,
              reason: "timestamp_equal_same_payload",
              localUpdatedAt: localTs.lastEditedAt ?? localTs.updatedAt ?? localTs.createdAt,
              remoteUpdatedAt: remoteTs.lastEditedAt ?? remoteTs.updatedAt ?? remoteTs.createdAt,
              localEditTimeMs: existingMs,
              remoteEditTimeMs: incomingMs,
              localDeleted: mirrorDocDeletedFlag(existing),
              remoteDeleted: mirrorDocDeletedFlag(payload),
              tiePrefersLocal,
              livePullPaused,
              localOfflineFirstPersistMs: localTs.offlineFirstPersistMs,
              remoteOfflineFirstPersistMs: remoteTs.offlineFirstPersistMs,
            });
            continue;
          }
          if (
            existingMs === incomingMs &&
            !incomingWinsTimestampTie &&
            (tiePrefersLocal || livePullPaused) &&
            !voucherApprovalDiffers &&
            !voucherServerFileOnTie
          ) {
            skipped += 1;
            mirrorMergeSkipLog({
              companyId,
              collection: collectionName,
              id,
              reason: livePullPaused ? "timestamp_equal_live_pull_paused" : "timestamp_equal_local_tiebreak",
              localUpdatedAt: localTs.lastEditedAt ?? localTs.updatedAt ?? localTs.createdAt,
              remoteUpdatedAt: remoteTs.lastEditedAt ?? remoteTs.updatedAt ?? remoteTs.createdAt,
              localEditTimeMs: existingMs,
              remoteEditTimeMs: incomingMs,
              localDeleted: mirrorDocDeletedFlag(existing),
              remoteDeleted: mirrorDocDeletedFlag(payload),
              tiePrefersLocal,
              livePullPaused,
              localOfflineFirstPersistMs: localTs.offlineFirstPersistMs,
              remoteOfflineFirstPersistMs: remoteTs.offlineFirstPersistMs,
            });
            continue;
          }
          if (collectionName === "vouchers") {
            const { mergeVoucherMirrorPullAttachments } = await import("@/lib/resolveVoucherAttachmentRemoteUrl");
            payload = mergeVoucherMirrorPullAttachments(existing, payload, {
              existingEditTimeMs: existingMs,
              incomingEditTimeMs: incomingMs,
            });
          }
        }
      } catch {
        /* compare optional */
      }
    }
    if (collectionName === "vouchers") {
      try {
        const existingForApproval = await getCompanyDocFromBrowserDb(companyId, collectionName, id, {
          sqliteOnly: true,
        });
        const { preserveLocalVoucherApprovalOverIncoming } = await import("@/lib/ledgerPendingApproval");
        const { preserveLocalVoucherBillWiseOverIncoming } = await import("@/lib/ledgerPendingBillWiseLinks");
        const pending = pendingApprovalOutboxById?.get(id) ?? null;
        payload = preserveLocalVoucherApprovalOverIncoming(
          existingForApproval as Record<string, unknown> | null,
          payload,
          pending
        );
        payload = preserveLocalVoucherBillWiseOverIncoming(
          existingForApproval as Record<string, unknown> | null,
          payload,
          pendingBillWiseOutboxById?.get(id) ?? null
        );
      } catch {
        /* optional */
      }
    }
    const written = await upsertCompanyDocInBrowserDb(companyId, collectionName, id, payload, {
      notify: false,
      force: forceUpsert,
      skipPlanMutationGate: collectionName === "vouchers",
    });
    if (written) upserted += 1;
    else {
      skipped += 1;
      failed += 1;
    }
  }
  if (authoritative) {
    await reconcileAuthoritativeCollectionSnapshot(companyId, collectionName, incomingIds);
  }
  return { upserted, skipped, failed };
}

/** P2P authoritative pull: server par na ho wale local rows hatao (pending push chhod ke). */
async function reconcileAuthoritativeCollectionSnapshot(
  companyId: string,
  collectionName: string,
  incomingIds: Set<string>
): Promise<void> {
  try {
    const { isPlServerLivePullPaused } = await import("@/lib/plServerClientDeltaSync");
    if (isPlServerLivePullPaused(companyId)) return;

    const existing = await listCompanyDocsFromBrowserDb(companyId, collectionName, { forBackupMerge: true });
    const alive = existing.filter((row) => !mirrorDocDeletedFlag(row as Record<string, unknown>));
    if (incomingIds.size === 0 && alive.length > 0) {
      console.warn(
        "[localCompanyDocMirror] skip authoritative prune — empty incoming batch with local rows",
        collectionName,
        alive.length
      );
      return;
    }
    if (incomingIds.size > 0 && incomingIds.size < alive.length) {
      console.warn(
        "[localCompanyDocMirror] skip authoritative prune — incoming batch is subset of local",
        collectionName,
        { incoming: incomingIds.size, localAlive: alive.length }
      );
      return;
    }
    let changed = false;
    for (const row of existing) {
      const id = String((row as { id?: string }).id || "").trim();
      if (!id || incomingIds.has(id)) continue;
      if (mirrorDocDeletedFlag(row as Record<string, unknown>)) continue;
      if (isPlServerDeltaDocPushPending(companyId, collectionName, id)) continue;
      await deleteCompanyDocFromBrowserDb(companyId, collectionName, id, { force: true, notify: false });
      changed = true;
    }
    if (changed || incomingIds.size === 0) {
      notifyBrowserDbCollectionUpdated(companyId, collectionName);
    }
  } catch (e) {
    console.warn("[localCompanyDocMirror] reconcileAuthoritativeCollectionSnapshot failed", collectionName, e);
  }
}

/**
 * After flush / server confirm: read any company subcollection doc from Firestore and refresh the SQLite mirror.
 * Applies to masters too — previously only vouchers were mirrored post-flush, so other devices could sync while this device stayed stale.
 */
export async function mirrorCompanyDocToBrowserDb(
  companyId: string,
  collectionName: string,
  docId: string
): Promise<boolean> {
  if (!shouldMirrorToBrowserDb() || !companyId || !collectionName || !docId) return false;
  try {
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    const fsCompanyId = String(reg?.authoritativeCompanyId || companyId).trim() || companyId;
    const ref = doc(firestore, `companies/${fsCompanyId}/${collectionName}`, docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    let payload: Record<string, unknown> = { id: snap.id, ...(snap.data() as Record<string, unknown>) };
    const ctx = reg ? { encryptServerBackupSalt: (reg as Record<string, unknown>).encryptServerBackupSalt as string | undefined } : null;
    const dec = await decryptFirestoreCompanyDocIfNeeded(
      payload as Record<string, unknown> & { id: string },
      ctx,
      companyId
    );
    if (dec) payload = dec;
    else if (isEncryptedServerBackupDoc(payload)) return false;
    if (collectionName === "vouchers") {
      const local = await getCompanyDocFromBrowserDb(companyId, collectionName, docId, { includeDeleted: true });
      const { preserveLocalVoucherApprovalOverIncoming } = await import("@/lib/ledgerPendingApproval");
      const { preserveLocalVoucherBillWiseOverIncoming } = await import("@/lib/ledgerPendingBillWiseLinks");
      const { readPendingApprovalOutboxByVoucherId, readPendingBillWiseOutboxByVoucherId } = await import(
        "@/lib/localVoucherOutbox"
      );
      const pending = (await readPendingApprovalOutboxByVoucherId(companyId)).get(docId) ?? null;
      const pendingBillWise = (await readPendingBillWiseOutboxByVoucherId(companyId)).get(docId) ?? null;
      payload = preserveLocalVoucherApprovalOverIncoming(
        local as Record<string, unknown> | null,
        payload,
        pending
      );
      payload = preserveLocalVoucherBillWiseOverIncoming(
        local as Record<string, unknown> | null,
        payload,
        pendingBillWise
      );
    }
    // Server snapshot = trusted read path; voucher plan gate yahan nahi (flush already paid-gated upstream where needed).
    // Unacknowledged SDK write (quota/offline) => keep unstamped: not confirmed by server.
    const mirrorRow = snap.metadata.hasPendingWrites ? payload : stampLocalMirrorBackedByFirestore(payload);
    await upsertCompanyDocInBrowserDb(companyId, collectionName, docId, mirrorRow, {
      notify: false,
      skipPlanMutationGate: true,
    });
    return true;
  } catch (e) {
    console.warn("[localCompanyDocMirror] mirror company doc failed", collectionName, docId, e);
    return false;
  }
}

/**
 * Voucher-specific alias for user-facing writes. Generic mirror batches stay silent,
 * but voucher saves/edits need an immediate bump in delta mode where Firestore
 * collection listeners are intentionally not bound.
 */
export async function mirrorVoucherDocToBrowserDb(companyId: string, voucherId: string): Promise<boolean> {
  const mirrored = await mirrorCompanyDocToBrowserDb(companyId, "vouchers", voucherId);
  if (mirrored) {
    notifyBrowserDbCollectionUpdated(companyId, "vouchers", { immediate: true, source: "local_write" });
  }
  return mirrored;
}
