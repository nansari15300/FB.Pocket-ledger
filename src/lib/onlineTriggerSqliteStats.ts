"use client";

import { collection, getCountFromServer } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { getBrowserDbForCompanyId } from "@/lib/localSqlite";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { countPendingFilesForCompany, listPendingFilesForCompany } from "@/lib/localPendingFiles";
import { getOutboxStatusCounts, listPendingOutboxDocIdsForCompany } from "@/lib/localVoucherOutbox";
import { computePushLocalCount } from "@/lib/localOnlyHardDeleteRules";
import { isServerQuotaHoldActive } from "@/lib/serverQuotaHold";
import { hasQuotaErrorThisPageLoad } from "@/lib/quotaAdminNotice";
import { listOnlineTriggerLog } from "@/lib/onlineTriggerLog";
import { listAttachmentFileRefs } from "@/lib/attachmentFileRefStore";
import { openDB } from "@/lib/offlineDb";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { electronStatAttachmentSizes } from "@/lib/electronAttachmentFs";
import { isTransientVoucherAttachmentUrl, normalizeFileUrlsField } from "@/lib/voucherAttachmentNormalize";

export type OnlineTriggerSqliteStats = {
  sqliteBytes: number;
  filesBytes: number;
  localVouchers: number;
  onlineVouchers: number | null;
  localFileCount: number;
  pendingFileCount: number;
  onlineFileCount: number | null;
  notOnOnline: number | null;
  notOnLocal: number | null;
  outboxPending: number;
  outboxFailed: number;
  outboxPaused: number;
  /** Push button: distinct queue rows (all statuses/collections) + pending files not already queued. */
  pushLocalCount: number;
  onlineError?: string;
};

export function formatSqliteStatBytes(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function companyIdAliases(ids: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function textBelongsToCompany(text: string, aliases: string[]): boolean {
  const t = String(text || "");
  if (!t || aliases.length === 0) return false;
  return aliases.some((id) => t.includes(id) || t.includes(encodeURIComponent(id)));
}

/** Stable key so token query / thumb suffix pe same file dobara na gine. */
function attachmentUrlKey(raw: string): string {
  const u = String(raw || "")
    .trim()
    .replace(/::cell-thumb(?:-v2)?$/i, "")
    .replace(/::pdf-portal$/i, "");
  if (!u) return "";
  return u.split("#")[0].split("?")[0];
}

function collectUrlsFromVoucherJson(data: string): string[] {
  try {
    const j = JSON.parse(data) as {
      fileUrls?: unknown;
      documentFileUrls?: unknown;
      unassignedFile?: unknown;
    };
    const urls = [
      ...normalizeFileUrlsField(j.fileUrls),
      ...normalizeFileUrlsField(j.documentFileUrls),
    ];
    const uf = j.unassignedFile;
    if (uf && typeof uf === "object" && uf !== null) {
      const url = String((uf as { url?: unknown }).url || "").trim();
      if (url) urls.push(url);
    }
    return urls.filter((u) => !isTransientVoucherAttachmentUrl(u));
  } catch {
    const out: string[] = [];
    const idx = data.indexOf('"fileUrls"');
    const slice = idx >= 0 ? data.slice(idx, idx + 12000) : data;
    for (const m of slice.match(/https:\/\/[^"\\\s]+/g) || []) out.push(m);
    for (const m of slice.match(/local:[^"\\\s]+/g) || []) out.push(m);
    return out;
  }
}

/**
 * Real UTF-8 bytes of ALL this company's rows in the local SQLite DB:
 * - every table with a `company_id` column (company_docs = vouchers/masters/other docs, company_docs_projection,
 *   company_users, sync_outbox, cloud_sync_outbox, cloud_sync_meta, + any future company-scoped table),
 * - this company's own row in `companies` / `local_companies` (by id).
 * Per column: `LENGTH(CAST(col AS BLOB))` = bytes (TEXT -> UTF-8 bytes; numbers -> their text form, close enough).
 * Not included (cannot be split per company): index b-trees, page/freelist overhead of the shared sql.js file.
 * attachment_file_refs rows (no company_id) are added separately by `localAttachmentBytes` for this company's files.
 */
function sqliteCompanyBytes(
  db: NonNullable<Awaited<ReturnType<typeof getBrowserDbForCompanyId>>>,
  aliases: string[]
): number {
  const ids = [...new Set(aliases.map((a) => String(a || "").trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const ph = ids.map(() => "?").join(",");
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  let tables: string[] = [];
  try {
    tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name?: string }[])
      .map((r) => String(r?.name || ""))
      .filter(Boolean);
  } catch {
    tables = ["company_docs", "companies", "local_companies"];
  }
  let n = 0;
  for (const table of tables) {
    let cols: string[] = [];
    try {
      cols = (db.prepare(`PRAGMA table_info(${q(table)})`).all() as { name?: string }[]).map((c) => String(c?.name || "")).filter(Boolean);
    } catch {
      continue;
    }
    const keyCol = cols.includes("company_id") ? "company_id" : table === "companies" || table === "local_companies" ? "id" : null;
    if (!keyCol || cols.length === 0) continue;
    const sumExpr = cols.map((c) => `COALESCE(LENGTH(CAST(${q(c)} AS BLOB)), 0)`).join(" + ");
    try {
      const row = db.prepare(`SELECT COALESCE(SUM(${sumExpr}), 0) AS n FROM ${q(table)} WHERE ${q(keyCol)} IN (${ph})`).get(...ids) as { n?: number } | undefined;
      n += Math.max(0, Number(row?.n) || 0);
    } catch {
      /* ignore */
    }
  }
  return n;
}

function countLocalVouchers(
  db: NonNullable<Awaited<ReturnType<typeof getBrowserDbForCompanyId>>>,
  aliases: string[]
): { count: number; fileKeys: Set<string> } {
  const seen = new Set<string>();
  const fileKeys = new Set<string>();
  let count = 0;
  for (const id of aliases) {
    const rows = db
      .prepare(
        `SELECT id, data FROM company_docs WHERE company_id = ? AND collection = 'vouchers'`
      )
      .all(id) as Array<{ id?: string; data?: string }>;
    for (const row of rows) {
      const vid = String(row?.id || "").trim();
      const data = String(row?.data || "");
      const key = vid || data.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      if (/"isDeleted"\s*:\s*true/.test(data)) continue;
      count += 1;
      for (const url of collectUrlsFromVoucherJson(data)) {
        const fk = attachmentUrlKey(url);
        if (fk) fileKeys.add(fk);
      }
    }
  }
  return { count, fileKeys };
}

/** Cached bytes for this company's voucher files only (not avatars / other companies). */
/** Data-folder file size cache (path -> bytes), short TTL so the page re-opens fast without re-stat of every file. */
const fileSizeCache = new Map<string, { size: number; at: number }>();
const FILE_SIZE_TTL_MS = 5 * 60 * 1000;

/** Real on-disk size via Capacitor Filesystem.stat (native only); null when not native / stat failed. */
async function statDataDirSizes(paths: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (paths.length === 0) return out;
  const now0 = Date.now();
  // Windows EXE (Electron): batched fs.stat in main process (no file read), same 5-min cache.
  if (isElectronDesktopApp()) {
    const todo = paths.filter((pth) => {
      const c = fileSizeCache.get(pth);
      if (c && now0 - c.at < FILE_SIZE_TTL_MS) { out.set(pth, c.size); return false; }
      return true;
    });
    const got = await electronStatAttachmentSizes(todo);
    for (const [pth, size] of got) { fileSizeCache.set(pth, { size, at: Date.now() }); out.set(pth, size); }
    return out;
  }
  // Web browser: no disk folder / OPFS here - files are IndexedDB blobs (blob.size is already actual) -> stored size.
  if (!isCapacitorNativeApp()) return out;
  let fs: typeof import("@capacitor/filesystem") | null = null;
  try {
    fs = await import("@capacitor/filesystem");
  } catch {
    return out;
  }
  const now = Date.now();
  const todo: string[] = [];
  for (const pth of paths) {
    const c = fileSizeCache.get(pth);
    if (c && now - c.at < FILE_SIZE_TTL_MS) out.set(pth, c.size);
    else todo.push(pth);
  }
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const pth = todo[next++];
      try {
        const st = await fs!.Filesystem.stat({ path: pth, directory: fs!.Directory.Data });
        const size = Math.max(0, Number(st?.size) || 0);
        fileSizeCache.set(pth, { size, at: Date.now() });
        out.set(pth, size);
      } catch {
        /* missing file -> caller falls back to stored size */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  return out;
}

const utf8Len = (s: unknown) => (s == null ? 0 : new TextEncoder().encode(String(s)).length);

async function localAttachmentBytes(aliases: string[], fileKeys: Set<string>): Promise<{ bytes: number; refRowBytes: number }> {
  const seen = new Set<string>();
  let bytes = 0;
  let refRowBytes = 0;
  const statJobs: { path: string; stored: number }[] = [];
  const add = (key: string, size: number) => {
    const k = String(key || "").trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    bytes += Math.max(0, Number(size) || 0);
  };

  try {
    const rows = await listAttachmentFileRefs("offline_cache");
    for (const r of rows) {
      let url = "";
      try {
        url = String(JSON.parse(String(r.metaJson || "{}"))?.url || "");
      } catch {
        url = "";
      }
      const blobKey = attachmentUrlKey(url) || url || r.filePath || `${r.scope}:${r.id}`;
      if (fileKeys.size > 0) {
        if (!fileKeys.has(blobKey) && !fileKeys.has(attachmentUrlKey(url))) continue;
      } else if (!textBelongsToCompany(`${url}\n${r.filePath}\n${r.id}`, aliases)) {
        continue;
      }
      const k = String(blobKey || "").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      refRowBytes += utf8Len(r.scope) + utf8Len(r.id) + utf8Len(r.filePath) + utf8Len(r.contentType) + utf8Len(r.metaJson) + utf8Len((r as { sha256Hex?: unknown }).sha256Hex) + 16;
      statJobs.push({ path: String(r.filePath || ""), stored: Math.max(0, Number(r.size) || 0) });
    }
    // Native: real file size from disk (parallel, limit 6, cached); web/Electron or stat failure: stored size.
    const real = await statDataDirSizes(statJobs.map((j) => j.path).filter(Boolean));
    for (const j of statJobs) bytes += real.has(j.path) ? real.get(j.path)! : j.stored;
  } catch {
    /* ignore */
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      if (!db.objectStoreNames.contains("offlineAttachmentBlobs")) {
        resolve();
        return;
      }
      const tx = db.transaction("offlineAttachmentBlobs", "readonly");
      const req = tx.objectStore("offlineAttachmentBlobs").getAll();
      req.onerror = () => resolve();
      req.onsuccess = () => {
        for (const row of (req.result || []) as Array<{
          id?: string;
          url?: string;
          size?: number;
          blob?: Blob;
        }>) {
          const url = String(row?.url || row?.id || "");
          const blobKey = attachmentUrlKey(url);
          if (fileKeys.size > 0) {
            if (!blobKey || !fileKeys.has(blobKey)) continue;
          } else if (!textBelongsToCompany(url, aliases)) {
            continue;
          }
          add(blobKey || url, Number(row?.blob?.size) || Number(row?.size) || 0);
        }
        resolve();
      };
    });
  } catch {
    /* ignore */
  }

  return { bytes, refRowBytes };
}

function localQuotaBlocksOnlineCount(): boolean {
  if (isServerQuotaHoldActive()) return true;
  if (hasQuotaErrorThisPageLoad()) return true;
  try {
    return listOnlineTriggerLog().some((r) => Number(r.quota || 0) > 0);
  } catch {
    return false;
  }
}

async function onlineVoucherCount(fsCompanyId: string): Promise<{ count: number | null; error?: string }> {
  if (localQuotaBlocksOnlineCount()) return { count: null, error: "quota" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { count: null, error: "offline" };
  }
  try {
    const snap = await Promise.race([
      getCountFromServer(collection(firestore, "companies", fsCompanyId, "vouchers")),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
    return { count: Math.max(0, Number(snap.data().count) || 0) };
  } catch (e) {
    const msg = String((e as Error)?.message || e || "");
    if (/resource-exhausted|quota/i.test(msg)) return { count: null, error: "quota" };
    return { count: null, error: "unavailable" };
  }
}

export async function loadOnlineTriggerSqliteStats(companyId: string): Promise<OnlineTriggerSqliteStats> {
  const cid = String(companyId || "").trim();
  const empty: OnlineTriggerSqliteStats = {
    sqliteBytes: 0,
    filesBytes: 0,
    localVouchers: 0,
    onlineVouchers: null,
    localFileCount: 0,
    pendingFileCount: 0,
    onlineFileCount: null,
    notOnOnline: null,
    notOnLocal: null,
    outboxPending: 0,
    outboxFailed: 0,
    outboxPaused: 0,
    pushLocalCount: 0,
  };
  if (!cid) return empty;

  let fsId = cid;
  try {
    const reg = await getLocalCompanyById(cid, { includeDeleted: true });
    fsId = String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || cid).trim() || cid;
  } catch {
    fsId = cid;
  }
  const aliases = companyIdAliases([cid, fsId]);

  const db = await getBrowserDbForCompanyId(cid);
  const sqliteBytes = db ? sqliteCompanyBytes(db, aliases) : 0;
  const vouchers = db ? countLocalVouchers(db, aliases) : { count: 0, fileKeys: new Set<string>() };
  const fileKeys = vouchers.fileKeys;

  let pendingFileCount = 0;
  let pendingBytes = 0;
  let pendingList: Array<{ id: string; docPath?: string }> = [];
  try {
    const pending = await listPendingFilesForCompany(cid);
    pendingList = pending.map((p) => ({ id: String(p.id || ''), docPath: p.docPath }));
    for (const p of pending) {
      const key = attachmentUrlKey(String(p.id || p.storagePathPrefix || ""));
      const size = Math.max(0, Number(p.blob?.size) || 0);
      if (key && fileKeys.has(key)) continue;
      pendingFileCount += 1;
      if (key) fileKeys.add(key);
      pendingBytes += size;
    }
  } catch {
    /* ignore */
  }

  const outbox = { pending: 0, failed: 0, paused: 0 };
  const queuedVouchers = new Set<string>();
  for (const alias of aliases) {
    const part = await getOutboxStatusCounts(alias).catch(() => ({
      pending: 0,
      failed: 0,
      paused: 0,
    }));
    outbox.pending += part.pending;
    outbox.failed += part.failed;
    outbox.paused += part.paused;
    const ids = await listPendingOutboxDocIdsForCompany(alias, "vouchers").catch(() => new Set<string>());
    for (const id of ids) queuedVouchers.add(id);
  }

  let pushLocalCount = 0;
  try {
    const qRows: Array<{ outboxId: string; collectionName: string; docId: string }> = [];
    if (db) {
      const ph = aliases.map(() => '?').join(',');
      const rs = db
        .prepare(`SELECT outbox_id, collection_name, doc_id FROM sync_outbox WHERE company_id IN (${ph})`)
        .all(...aliases) as Array<{ outbox_id: string; collection_name: string; doc_id: string }>;
      for (const r of rs) qRows.push({ outboxId: String(r.outbox_id), collectionName: String(r.collection_name), docId: String(r.doc_id) });
    }
    pushLocalCount = computePushLocalCount(qRows, pendingList);
  } catch {
    pushLocalCount = outbox.pending + outbox.failed + outbox.paused + pendingFileCount;
  }

  const online = await onlineVoucherCount(fsId);
  const att = await localAttachmentBytes(aliases, fileKeys);
  const cachedFileBytes = att.bytes;

  const localVouchers = vouchers.count;
  const onlineVouchers = online.count;
  const notOnOnline =
    onlineVouchers == null
      ? queuedVouchers.size || null
      : Math.max(0, localVouchers - onlineVouchers, queuedVouchers.size);
  const notOnLocal = onlineVouchers == null ? null : Math.max(0, onlineVouchers - localVouchers);

  return {
    sqliteBytes: sqliteBytes + att.refRowBytes,
    filesBytes: cachedFileBytes + pendingBytes,
    localVouchers,
    onlineVouchers,
    localFileCount: fileKeys.size,
    pendingFileCount,
    onlineFileCount: null,
    notOnOnline,
    notOnLocal,
    outboxPending: outbox.pending,
    outboxFailed: outbox.failed,
    outboxPaused: outbox.paused,
    pushLocalCount,
    onlineError: online.error,
  };
}
