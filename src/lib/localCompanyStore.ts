"use client";

/**
 * Local-only company registry in browser SQLite.
 * App static/offline mode me company CRUD isi store se karega.
 * Data lives in three folders: local | plservers | online (`sqliteStorageNamespace`).
 */

import {
  flushPendingBrowserDbSave,
  getBrowserDbForCompanyId,
  getBrowserDbForNamespace,
  findCompanyRowAcrossNamespaces,
  moveCompanySqliteNamespace,
  warmAllBrowserSqliteNamespaces,
} from "@/lib/localSqlite";
import { mergePersistedLocalCloudSyncUserSettings } from "@/lib/localCloudSync/persistRegistryUserSettings";
import { notePocketBaseCompanyRow } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { filterFirebaseCompaniesForServerSession } from "@/lib/pocketbaseData/serverSessionCompanyScope";
import { clearLocalAuth } from "@/lib/localApiClient";
import { clearCompanyPlanLocalCache } from "@/lib/companyPlanLocalCache";
import { clearCloudCompanyPasswordUnlockSession } from "@/lib/cloudCompanyPasswordUnlockRemember";
import { clearOfflineUnlockSession } from "@/lib/offlineCompanyUnlockRemember";
import { clearRememberedSharedUnlockUsername } from "@/lib/onlineSharedUnlockRememberUsername";
import {
  SQLITE_STORAGE_NAMESPACES,
  resolveSqliteStorageNamespace,
  writeCachedCompanySqliteNamespace,
  readCachedCompanySqliteNamespace,
  clearCachedCompanySqliteNamespace,
  type SqliteStorageNamespace,
} from "@/lib/sqliteStorageNamespace";

const REMOVED_COMPANY_TOMBSTONE_PREFIX = "pl_removed_local_company_v1:";
const REMOVED_COMPANY_TOMBSTONE_MS = 10 * 60 * 1000;

export type LocalCompanyDoc = {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail?: string | null;
  isDeleted?: boolean;
  /** Offline login users (username/password) — `src/lib/localCompanyUsers.ts` */
  localCompanyUsers?: Array<{
    id: string;
    username: string;
    displayName: string;
    role: string;
    password: string;
  }>;
  [key: string]: unknown;
};

function shouldStampAsLocalOnly(row: LocalCompanyDoc | null | undefined): boolean {
  if (!row) return false;
  if ((row as { plServerShared?: unknown }).plServerShared === true) return false;
  if ((row as { localOnly?: unknown }).localOnly === true) return true;
  if ((row as { firestoreSyncDisabled?: unknown }).firestoreSyncDisabled === true) return true;
  if (String((row as { localPersistence?: unknown }).localPersistence ?? "").toLowerCase().trim() === "sqlite") return true;
  if (String((row as { storageOption?: unknown }).storageOption ?? "").toLowerCase().trim() === "local") return true;
  if (String((row as { syncPolicy?: unknown }).syncPolicy ?? "").toLowerCase().trim() === "offline") return true;
  return false;
}

function stampLocalOnlyCompanyDoc<T extends LocalCompanyDoc>(row: T): T {
  return {
    ...row,
    localOnly: true,
    localPersistence: "sqlite",
    firestoreSyncDisabled: true,
    storageOption: "local",
    syncPolicy: "offline",
    syncedFromCloud: false,
    authoritativeCompanyId: "",
  } as T;
}

function safeParseCompany(json: string): LocalCompanyDoc | null {
  try {
    return JSON.parse(json) as LocalCompanyDoc;
  } catch {
    return null;
  }
}

/** SQLite/JSON mirror kabhi `1` / `"true"` bhej sakta hai — strict `=== true` filters / purge logic is se safe rahein. */
export function localCompanyRowIsDeleted(row: { isDeleted?: unknown }): boolean {
  const v = row.isDeleted;
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1";
  }
  return false;
}

async function ensureCompanyInNamespace(
  companyId: string,
  targetNs: SqliteStorageNamespace
): Promise<void> {
  const cached = readCachedCompanySqliteNamespace(companyId);
  if (cached === targetNs) return;
  await moveCompanySqliteNamespace(companyId, targetNs);
}

export async function upsertLocalCompany(company: LocalCompanyDoc): Promise<void> {
  if (!company?.id) return;
  // Pocket Ledger Server companies (`onlineServerId: "pocketbase"`) - remembered for the sync routing.
  notePocketBaseCompanyRow(company.id, company);
  const now = Date.now();
  const existing = await getLocalCompanyById(company.id, { includeDeleted: true });
  const mergedRaw = mergePersistedLocalCloudSyncUserSettings(existing, company);
  const merged = shouldStampAsLocalOnly(company) || shouldStampAsLocalOnly(existing)
    ? stampLocalOnlyCompanyDoc(mergedRaw)
    : mergedRaw;

  const targetNs = resolveSqliteStorageNamespace(merged);
  await ensureCompanyInNamespace(merged.id, targetNs);
  const db = await getBrowserDbForNamespace(targetNs);
  if (!db) return;

  if (targetNs === "online") {
    db.prepare(
      `INSERT INTO companies(id, data, updatedAt)
       VALUES(?,?,?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`
    ).run(merged.id, JSON.stringify(merged), now);
    try {
      db.prepare(`DELETE FROM local_companies WHERE id = ?`).run(merged.id);
    } catch {
      /* ignore */
    }
  } else {
    const rowForStore =
      targetNs === "local" ? stampLocalOnlyCompanyDoc(merged) : merged;
    db.prepare(
      `INSERT INTO local_companies(id, data, updatedAt)
       VALUES(?,?,?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`
    ).run(rowForStore.id, JSON.stringify(rowForStore), now);
    db.prepare(`DELETE FROM companies WHERE id = ?`).run(merged.id);
  }
  writeCachedCompanySqliteNamespace(merged.id, targetNs);
}

/**
 * Local-only → online promotion: move SQLite folder local → online, then write cloud shape.
 */
export async function promoteLocalCompanyRowToOnline(
  companyId: string,
  patch?: Partial<LocalCompanyDoc>
): Promise<LocalCompanyDoc | null> {
  const cid = String(companyId || "").trim();
  if (!cid) return null;
  const existing = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!existing && !patch) return null;

  const mergedRaw = mergePersistedLocalCloudSyncUserSettings(existing, {
    ...(existing || { id: cid, name: cid, ownerId: "" }),
    ...(patch || {}),
    id: cid,
  } as LocalCompanyDoc);
  const promoted: LocalCompanyDoc = {
    ...mergedRaw,
    id: cid,
    storageOption: "firebase",
    syncPolicy: "online",
    syncedFromCloud: (patch as { syncedFromCloud?: boolean } | undefined)?.syncedFromCloud === true,
    authoritativeCompanyId: cid,
    localOnly: false,
    firestoreSyncDisabled: false,
    updatedAt: Date.now(),
  };
  delete (promoted as { demoteReason?: unknown }).demoteReason;
  delete (promoted as { demotedFromOnlineAt?: unknown }).demotedFromOnlineAt;
  delete (promoted as { localPersistence?: unknown }).localPersistence;
  delete (promoted as { plServerShared?: unknown }).plServerShared;

  await moveCompanySqliteNamespace(cid, "online");
  const db = await getBrowserDbForNamespace("online");
  if (!db) return null;

  const now = Date.now();
  db.prepare(
    `INSERT INTO companies(id, data, updatedAt)
     VALUES(?,?,?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`
  ).run(cid, JSON.stringify(promoted), now);
  try {
    db.prepare(`DELETE FROM local_companies WHERE id = ?`).run(cid);
  } catch {
    /* pre-local_companies DB */
  }
  writeCachedCompanySqliteNamespace(cid, "online");
  try {
    await flushPendingBrowserDbSave();
  } catch {
    /* best-effort */
  }
  return promoted;
}

export async function getLocalCompanyById(
  companyId: string,
  options?: { includeDeleted?: boolean }
): Promise<LocalCompanyDoc | null> {
  if (!companyId) return null;
  const found = await findCompanyRowAcrossNamespaces(companyId);
  if (!found?.data) return null;
  const parsed = safeParseCompany(found.data);
  if (!parsed) return null;
  if (options?.includeDeleted !== true && localCompanyRowIsDeleted(parsed)) return null;
  return { ...parsed, id: found.id };
}

export async function listLocalCompanies(options?: { includeDeleted?: boolean }): Promise<LocalCompanyDoc[]> {
  await warmAllBrowserSqliteNamespaces();
  const out: LocalCompanyDoc[] = [];
  const seen = new Set<string>();
  const includeDeleted = options?.includeDeleted === true;
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    const db = await getBrowserDbForNamespace(ns);
    if (!db) continue;
    const rows = [
      ...(db.prepare(`SELECT id, data, updatedAt FROM local_companies ORDER BY updatedAt DESC`).all() as Array<{
        id: string;
        data: string;
        updatedAt?: number;
      }>),
      ...(db.prepare(`SELECT id, data, updatedAt FROM companies ORDER BY updatedAt DESC`).all() as Array<{
        id: string;
        data: string;
        updatedAt?: number;
      }>),
    ];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const parsed = safeParseCompany(row.data);
      if (!parsed) continue;
      if (!includeDeleted && localCompanyRowIsDeleted(parsed)) continue;
      if (readCachedCompanySqliteNamespace(row.id) !== ns) {
        writeCachedCompanySqliteNamespace(row.id, ns);
      }
      out.push({ ...parsed, id: row.id });
    }
  }
  // Server-only login: cached Firebase company rows stay in SQLite but are not listed anywhere.
  return filterFirebaseCompaniesForServerSession(out);
}

export type RemoveLocalCompanyOptions = {
  /** Firebase Auth uid — company unlock / remember sessions hataane ke liye */
  firebaseUid?: string | null;
};

function markLocalCompanyRecentlyRemoved(companyId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${REMOVED_COMPANY_TOMBSTONE_PREFIX}${companyId}`, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function wasLocalCompanyRecentlyRemoved(companyId: string): boolean {
  if (typeof window === "undefined") return false;
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  try {
    const key = `${REMOVED_COMPANY_TOMBSTONE_PREFIX}${cid}`;
    const raw = window.localStorage.getItem(key);
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    if (Date.now() - ts <= REMOVED_COMPANY_TOMBSTONE_MS) return true;
    window.localStorage.removeItem(key);
    return false;
  } catch {
    return false;
  }
}

/**
 * Device se company ka saara local data hatao: registry + company_docs + users + sync outbox + related localStorage.
 */
export async function removeLocalCompanyById(
  companyId: string,
  options?: RemoveLocalCompanyOptions
): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  markLocalCompanyRecentlyRemoved(cid);

  // Delete from every folder in case of stale duplicates.
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    const db = await getBrowserDbForNamespace(ns);
    if (!db) continue;
    db.prepare(`DELETE FROM company_docs WHERE company_id = ?`).run(cid);
    db.prepare(`DELETE FROM company_docs_projection WHERE company_id = ?`).run(cid);
    db.prepare(`DELETE FROM company_users WHERE company_id = ?`).run(cid);
    db.prepare(`DELETE FROM sync_outbox WHERE company_id = ?`).run(cid);
    try {
      db.prepare(`DELETE FROM cloud_sync_outbox WHERE company_id = ?`).run(cid);
      db.prepare(`DELETE FROM cloud_sync_meta WHERE company_id = ?`).run(cid);
    } catch {
      /* pre-v3 DB */
    }
    try {
      db.prepare(`DELETE FROM local_companies WHERE id = ?`).run(cid);
    } catch {
      /* pre-local_companies DB */
    }
    db.prepare(`DELETE FROM companies WHERE id = ?`).run(cid);
  }
  clearCachedCompanySqliteNamespace(cid);

  try {
    clearLocalAuth(cid);
  } catch {
    /* ignore */
  }
  try {
    clearCompanyPlanLocalCache(cid);
  } catch {
    /* ignore */
  }
  const uid = options?.firebaseUid;
  if (uid != null && String(uid).trim()) {
    const u = String(uid).trim();
    try {
      clearCloudCompanyPasswordUnlockSession(u, cid);
      clearOfflineUnlockSession(u, cid);
      clearRememberedSharedUnlockUsername(u, cid);
    } catch {
      /* ignore */
    }
  }
  try {
    await flushPendingBrowserDbSave();
  } catch {
    /* best-effort */
  }
}

/** @deprecated Prefer getBrowserDbForCompanyId — kept for rare call sites */
export async function getDbForLocalCompany(companyId: string) {
  return getBrowserDbForCompanyId(companyId);
}
