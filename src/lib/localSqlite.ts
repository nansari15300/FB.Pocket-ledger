/**
 * Browser-only SQLite (sql.js + IndexedDB persist).
 * Use when data source = "browser" (no Node server). See docs/BROWSER-SQLITE-NO-SERVER.md.
 */

import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import {
  SQLITE_STORAGE_NAMESPACES,
  type SqliteStorageNamespace,
  isSqliteStorageNamespace,
  resolveSqliteStorageNamespace,
  readCachedCompanySqliteNamespace,
  writeCachedCompanySqliteNamespace,
  clearCachedCompanySqliteNamespace,
} from "@/lib/sqliteStorageNamespace";

const BASE_IDB_NAME = "pocket-ledger-browser-db";
const LEGACY_IDB_NAME = BASE_IDB_NAME;
const IDB_STORE = "store";
/** Pre-namespace single-blob key (migrated once into local/plservers/online). */
const IDB_KEY_LEGACY = "sqlite-db";
const IDB_KEY_MIGRATED = "sqlite-ns-migrated-v1";

function idbKeyForNamespace(ns: SqliteStorageNamespace): string {
  return `sqlite-db__${ns}`;
}

export type SqlJsDatabase = import("sql.js").Database;

/**
 * Pending-IDB (`offlineDb`) + browser-sqlite-IDB dono isi suffix se naam banate hain — drift se write/read alag DB na ho.
 * `127.0.0.1` → `localhost` normalize: warna same dev machine par do IndexedDB namespaces (cache MISS / FILE fallback).
 */
export function getBrowserIndexedDbHostScope(): string {
  if (typeof window === "undefined") return "default";
  // Embedded/native: WebView localhost port app restart par badal sakta hai; fixed scope se SQLite persistence stable rakho.
  if (isCapacitorNativeApp()) return "capacitor_native_embedded";
  // Electron packaged localhost: runtime port drift se DB split avoid.
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
  // Electron loopback: same scope for localhost / 127.0.0.1 so stray tabs stay name-aligned (origin still must match).
  const loopbackHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]";
  if (ua.includes("electron") && loopbackHost) return "electron_embedded";
  // Host-based DB scope: localhost vs production domain ko अलग rakhkar data conflict avoid kare.
  const rawHost = window.location.hostname || "unknown";
  const hostForScope = rawHost === "127.0.0.1" ? "localhost" : rawHost;
  const host = `${hostForScope}${window.location.port ? `-${window.location.port}` : ""}`;
  return host.replace(/[^a-zA-Z0-9_.-]/g, "_").toLowerCase();
}

function getScopedIdbName(): string {
  return `${BASE_IDB_NAME}__${getBrowserIndexedDbHostScope()}`;
}

function getHostPortScopeForLegacyFallback(): string {
  if (typeof window === "undefined") return "default";
  const rawHost = window.location.hostname || "unknown";
  const hostForScope = rawHost === "127.0.0.1" ? "localhost" : rawHost;
  const host = `${hostForScope}${window.location.port ? `-${window.location.port}` : ""}`;
  return host.replace(/[^a-zA-Z0-9_.-]/g, "_").toLowerCase();
}

function openIndexedDB(idbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(idbName, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
  });
}

/** APK/EXE update par purane IndexedDB scope se SQLite one-time import. */
async function collectLegacySqliteIdbNames(scopedName: string): Promise<string[]> {
  const names = new Set<string>();
  names.add(LEGACY_IDB_NAME);
  names.add(`${BASE_IDB_NAME}__${getHostPortScopeForLegacyFallback()}`);
  if (isCapacitorNativeApp()) {
    for (const suffix of [
      "localhost",
      "localhost-3000",
      "localhost-8080",
      "localhost-4173",
      "localhost-5173",
      "capacitor_localhost",
      "unknown",
    ]) {
      names.add(`${BASE_IDB_NAME}__${suffix}`);
    }
    if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
      try {
        const dbs = await indexedDB.databases();
        for (const meta of dbs) {
          const n = String(meta.name || "").trim();
          if (n.startsWith(BASE_IDB_NAME) && n !== scopedName) names.add(n);
        }
      } catch {
        /* ignore */
      }
    }
  }
  names.delete(scopedName);
  return [...names];
}

function readIdbKey(idbName: string, key: string): Promise<ArrayBuffer | null> {
  return openIndexedDB(idbName).then(
    (idb) =>
      new Promise<ArrayBuffer | null>((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => {
          idb.close();
          const v = req.result;
          if (v == null) {
            resolve(null);
            return;
          }
          if (typeof v === "string") {
            resolve(null);
            return;
          }
          const buf = v instanceof ArrayBuffer ? v : (v as Uint8Array).buffer;
          resolve(buf instanceof ArrayBuffer ? buf : new Uint8Array(buf as ArrayBufferLike).slice().buffer);
        };
        req.onerror = () => {
          idb.close();
          reject(req.error);
        };
      })
  );
}

function writeIdbKey(idbName: string, key: string, data: Uint8Array | string): Promise<void> {
  return openIndexedDB(idbName).then(
    (idb) =>
      new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, "readwrite");
        const store = tx.objectStore(IDB_STORE);
        store.put(data, key);
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => {
          idb.close();
          reject(tx.error);
        };
      })
  );
}

/** IndexedDB se namespace DB binary read. Nahi mile to null. */
export async function loadDbFromIndexedDB(
  ns: SqliteStorageNamespace = "local"
): Promise<ArrayBuffer | null> {
  const scopedName = getScopedIdbName();
  const key = idbKeyForNamespace(ns);
  const scoped = await readIdbKey(scopedName, key);
  if (scoped && scoped.byteLength > 64) return scoped;
  // Only the local namespace inherits pre-split single-blob / legacy IDB names.
  if (ns !== "local") return scoped;
  const legacyBlob = await readIdbKey(scopedName, IDB_KEY_LEGACY);
  if (legacyBlob && legacyBlob.byteLength > 64) return legacyBlob;

  const legacyNames = await collectLegacySqliteIdbNames(scopedName);
  let best: ArrayBuffer | null = null;
  for (const name of legacyNames) {
    try {
      const buf =
        (await readIdbKey(name, key)) ||
        (await readIdbKey(name, IDB_KEY_LEGACY));
      if (buf && buf.byteLength > 64 && (!best || buf.byteLength > best.byteLength)) {
        best = buf;
      }
    } catch {
      /* try next */
    }
  }
  if (best) {
    await saveDbToIndexedDB(new Uint8Array(best), "local");
    return best;
  }
  return scoped;
}

/** DB binary IndexedDB me save (namespace folder key). */
export function saveDbToIndexedDB(
  data: Uint8Array,
  ns: SqliteStorageNamespace = "local"
): Promise<void> {
  return writeIdbKey(getScopedIdbName(), idbKeyForNamespace(ns), data);
}

/** Server jaisa schema – companies, company_docs, company_users. */
function initSchema(db: SqlJsDatabase): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}',
      updatedAt INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS local_companies (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}',
      updatedAt INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS company_docs (
      company_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      updatedAt INTEGER,
      PRIMARY KEY (company_id, collection, id)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_company_docs_company_collection
    ON company_docs(company_id, collection)
  `);
  // Capacitor attachment migration: bytes DataDirectory me, SQLite me stable refs (path/meta) only.
  db.run(`
    CREATE TABLE IF NOT EXISTS attachment_file_refs (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT,
      updatedAt INTEGER,
      PRIMARY KEY (scope, id)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_attachment_file_refs_scope_updated
    ON attachment_file_refs(scope, updatedAt)
  `);
  // Dashboard-friendly voucher projection: full JSON parse se pehle amount/date/type columns quick read.
  db.run(`
    CREATE TABLE IF NOT EXISTS company_docs_projection (
      company_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      doc_type TEXT,
      doc_date_ms INTEGER,
      amount_value REAL,
      updatedAt INTEGER,
      PRIMARY KEY (company_id, collection, id)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_company_docs_projection_company_collection_date
    ON company_docs_projection(company_id, collection, doc_date_ms)
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS company_users (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'user',
      created_at INTEGER,
      PRIMARY KEY (company_id, id),
      UNIQUE(company_id, username)
    )
  `);
  // Firestore sync queue (static/offline voucher create/update — demo slice)
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_outbox (
      outbox_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      op TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_company_created
    ON sync_outbox(company_id, created_at)
  `);
  migrateBrowserSqliteSchema(db);
}

/** Purane DB files: naye columns ALTER se — outbox anti-spoof + attachment sha256 integrity. */
function migrateBrowserSqliteSchema(db: SqlJsDatabase): void {
  const vRow = db.exec("PRAGMA user_version");
  let v = 0;
  if (vRow.length > 0 && vRow[0].values.length > 0) {
    const cell = vRow[0].values[0]![0];
    v = typeof cell === "number" ? cell : Number(cell) || 0;
  }
  const setUserVersion = (n: number) => db.run(`PRAGMA user_version = ${n}`);
  if (v < 1) {
    try {
      db.run("ALTER TABLE sync_outbox ADD COLUMN client_write_id TEXT");
    } catch {
      /* column already exists */
    }
    try {
      db.run("ALTER TABLE sync_outbox ADD COLUMN nonce TEXT");
    } catch {
      /* ignore */
    }
    try {
      db.run("ALTER TABLE sync_outbox ADD COLUMN payload_hash TEXT");
    } catch {
      /* ignore */
    }
    setUserVersion(1);
    v = 1;
  }
  if (v < 2) {
    try {
      db.run("ALTER TABLE attachment_file_refs ADD COLUMN sha256_hex TEXT");
    } catch {
      /* ignore */
    }
    setUserVersion(2);
    v = 2;
  }
  // Local-company Google Drive delta sync — `sync_outbox` (Firestore) se alag queue
  if (v < 3) {
    db.run(`
      CREATE TABLE IF NOT EXISTS cloud_sync_outbox (
        op_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        action TEXT NOT NULL,
        row_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        op_seq INTEGER NOT NULL,
        payload TEXT NOT NULL,
        synced_at INTEGER
      )
    `);
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_cloud_sync_outbox_company_pending
      ON cloud_sync_outbox(company_id, synced_at, op_seq)
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS cloud_sync_meta (
        company_id TEXT PRIMARY KEY,
        last_local_op_seq INTEGER NOT NULL DEFAULT 0,
        last_synced_op INTEGER NOT NULL DEFAULT 0,
        last_sync_at INTEGER,
        sync_status TEXT NOT NULL DEFAULT 'idle',
        last_error TEXT
      )
    `);
    setUserVersion(3);
  }
}

/** Server-style prepare().get/run/all wrapper; har write ke baad IndexedDB me save. */
export interface BrowserDbWrapper {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
  exec(sql: string): void;
  /** Raw sql.js Database – export() / close() ke liye. */
  raw: SqlJsDatabase;
  /** Which storage folder this wrapper belongs to. */
  namespace: SqliteStorageNamespace;
}

type CachedNsDb = {
  wrapper: BrowserDbWrapper;
  db: SqlJsDatabase;
  pendingSaveFn: (() => Promise<void>) | null;
  pendingSaveTimer: ReturnType<typeof setTimeout> | null;
};

const cachedByNs: Partial<Record<SqliteStorageNamespace, CachedNsDb>> = {};
const openPromiseByNs: Partial<Record<SqliteStorageNamespace, Promise<BrowserDbWrapper | null>>> = {};
let sqlJsModulePromise: Promise<typeof import("sql.js").default> | null = null;
let migrateNamespacesPromise: Promise<void> | null = null;

/** Cross-renderer: host tab IDB likhe ke baad bridge/sibling stale sql.js drop kare (bina stale flush). */
export const SQLITE_SIBLING_IDB_RELOAD_CHANNEL = "pocket-ledger-sqlite-idb-reload";
const SQLITE_SIBLING_IDB_RELOAD_STORAGE_KEY = "pocket-ledger-sqlite-idb-reload";
const SQLITE_SIBLING_SENDER_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `sqlite-sender-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Hidden Electron `?pl_server_data_bridge=1` — same IndexedDB, alag in-memory sql.js. */
export function isServerDataBridgeRenderer(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if ((window as unknown as { __plIsCanonicalServerBridge?: boolean }).__plIsCanonicalServerBridge === true) {
      return true;
    }
    return new URLSearchParams(window.location.search).get("pl_server_data_bridge") === "1";
  } catch {
    return false;
  }
}

function plRoleSqliteLog(step: string, detail?: Record<string, unknown>): void {
  void import("@/lib/plRoleChangeLog")
    .then(({ plRoleLog }) => plRoleLog(step, detail))
    .catch(() => undefined);
}

/**
 * Host company-meta / role save ke baad: sibling renderers (hidden bridge) apni
 * purani sql.js memory drop karein — warna unka scheduleSave/lifecycle flush
 * IndexedDB pe purana `localCompanyUsers` wapas likh deta hai (F5 + staff stale role).
 * Caller window apna cache nahi giraata.
 */
export function notifySiblingRenderersReloadBrowserDbFromIndexedDb(
  detail?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  const payload = {
    senderId: SQLITE_SIBLING_SENDER_ID,
    at: Date.now(),
    ...(detail || {}),
  };
  plRoleSqliteLog("sibling_reload_emit", {
    ...payload,
    isBridge: isServerDataBridgeRenderer(),
  });
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(SQLITE_SIBLING_IDB_RELOAD_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.setItem(SQLITE_SIBLING_IDB_RELOAD_STORAGE_KEY, JSON.stringify(payload));
    window.localStorage.removeItem(SQLITE_SIBLING_IDB_RELOAD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function applySiblingIdbReloadFromPeer(raw: unknown): void {
  const senderId =
    raw && typeof raw === "object" && "senderId" in raw
      ? String((raw as { senderId?: unknown }).senderId || "")
      : "";
  if (senderId && senderId === SQLITE_SIBLING_SENDER_ID) return;
  plRoleSqliteLog("sibling_reload_recv", {
    senderId: senderId || null,
    isBridge: isServerDataBridgeRenderer(),
  });
  // Stale memory drop — IDB pe flush mat karo (host already likh chuka).
  clearBrowserDbCache();
}

function registerBrowserDbLifecycleFlushOnce(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    __plBrowserDbFlushRegistered?: boolean;
    __plBrowserDbSiblingReloadRegistered?: boolean;
  };
  if (!w.__plBrowserDbFlushRegistered) {
    w.__plBrowserDbFlushRegistered = true;
    const flush = () => {
      // Bridge auto-flush clobbers host Manage Sharing role writes in shared IndexedDB.
      if (isServerDataBridgeRenderer()) {
        plRoleSqliteLog("lifecycle_flush_skip_bridge", { reason: "avoid_stale_idb_clobber" });
        return;
      }
      void flushPendingBrowserDbSave();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
  if (!w.__plBrowserDbSiblingReloadRegistered) {
    w.__plBrowserDbSiblingReloadRegistered = true;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(SQLITE_SIBLING_IDB_RELOAD_CHANNEL);
        channel.addEventListener("message", (ev) => applySiblingIdbReloadFromPeer(ev.data));
      }
    } catch {
      /* ignore */
    }
    window.addEventListener("storage", (ev) => {
      if (ev.key !== SQLITE_SIBLING_IDB_RELOAD_STORAGE_KEY || !ev.newValue) return;
      try {
        applySiblingIdbReloadFromPeer(JSON.parse(ev.newValue));
      } catch {
        applySiblingIdbReloadFromPeer({ at: Date.now() });
      }
    });
  }
}
registerBrowserDbLifecycleFlushOnce();

// SQLite bind ke liye unsupported JS values ko deterministic scalar me normalize karo.
function normalizeSqlParam(value: unknown): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.getTime();
  return value;
}

/**
 * sql.js keeps the whole DB in memory; persisting = db.export() (synchronous, whole file) + IndexedDB put.
 * On a fully mirrored online company that export is multi-MB and blocks the main thread for seconds, so it
 * must never run per write. Trailing debounce (coalesces a save's burst of writes) with a max wait, run in
 * idle time. pagehide flush (below) still persists on tab close.
 */
const PERSIST_DEBOUNCE_MS = 5000;
const PERSIST_MAX_WAIT_MS = 30_000;
function armDebouncedPersist(
  cur: { pendingSaveTimer: ReturnType<typeof setTimeout> | null },
  run: () => Promise<void>
): void {
  const c = cur as { pendingSaveTimer: ReturnType<typeof setTimeout> | null; persistFirstArmAt?: number };
  const now = Date.now();
  if (!c.persistFirstArmAt) c.persistFirstArmAt = now;
  if (c.pendingSaveTimer) clearTimeout(c.pendingSaveTimer);
  const wait = Math.max(0, Math.min(PERSIST_DEBOUNCE_MS, c.persistFirstArmAt + PERSIST_MAX_WAIT_MS - now));
  c.pendingSaveTimer = setTimeout(() => {
    c.pendingSaveTimer = null;
    c.persistFirstArmAt = 0;
    const go = () => {
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      void run()
        .catch(() => undefined)
        .finally(() => {
          const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
          console.info("[PL-DEBUG-SAVE] t=db-persist(export+idb)", Math.round(t1 - t0), "ms");
        });
    };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof ric === "function") ric(go, { timeout: 3000 });
    else go();
  }, wait);
}

function wrapDb(
  db: SqlJsDatabase,
  ns: SqliteStorageNamespace,
  onSave: () => Promise<void>
): BrowserDbWrapper {
  const entry = cachedByNs[ns];
  if (entry) entry.pendingSaveFn = onSave;
  const scheduleSave = () => {
    // Bridge: sirf explicit `flushPendingBrowserDbSave` (delta apply) IDB likhe.
    // Debounced auto-save purani company meta se host role overwrite karti thi.
    if (isServerDataBridgeRenderer()) return;
    const cur = cachedByNs[ns];
    if (!cur) return;
    armDebouncedPersist(cur, onSave);
  };
  return {
    raw: db,
    namespace: ns,
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        get(...params: unknown[]) {
          try {
            if (params.length) stmt.bind(params.map((p) => normalizeSqlParam(p)) as unknown[]);
            const ok = stmt.step();
            return ok ? (stmt.getAsObject() as unknown) : undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params: unknown[]) {
          try {
            if (params.length) stmt.bind(params.map((p) => normalizeSqlParam(p)) as unknown[]);
            const rows: unknown[] = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally {
            stmt.free();
          }
        },
        run(...params: unknown[]) {
          try {
            if (params.length) stmt.bind(params.map((p) => normalizeSqlParam(p)) as unknown[]);
            stmt.step();
          } finally {
            stmt.free();
          }
          const changes = Number(db.getRowsModified?.() ?? 0);
          scheduleSave();
          return { changes };
        },
      };
    },
    exec(sql: string) {
      db.run(sql);
      scheduleSave();
    },
  };
}

async function getSqlJsCtor(): Promise<typeof import("sql.js").default> {
  if (!sqlJsModulePromise) {
    sqlJsModulePromise = import("sql.js").then((m) => m.default);
  }
  return sqlJsModulePromise;
}

function parseCompanyJson(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function companyIdsInDb(db: SqlJsDatabase): Set<string> {
  const ids = new Set<string>();
  try {
    const stmt = db.prepare(`SELECT id FROM local_companies`);
    while (stmt.step()) {
      const row = stmt.getAsObject() as { id?: string };
      if (row.id) ids.add(String(row.id));
    }
    stmt.free();
  } catch {
    /* ignore */
  }
  try {
    const stmt = db.prepare(`SELECT id FROM companies`);
    while (stmt.step()) {
      const row = stmt.getAsObject() as { id?: string };
      if (row.id) ids.add(String(row.id));
    }
    stmt.free();
  } catch {
    /* ignore */
  }
  return ids;
}

function copyCompanyScopedRows(
  source: SqlJsDatabase,
  dest: SqlJsDatabase,
  companyId: string
): void {
  const cid = String(companyId).trim();
  if (!cid) return;
  const copyTable = (sqlSelect: string, sqlInsert: string, cols: number) => {
    const stmt = source.prepare(sqlSelect);
    const insert = dest.prepare(sqlInsert);
    try {
      stmt.bind([cid]);
      while (stmt.step()) {
        const vals = stmt.get();
        insert.run(vals.slice(0, cols) as unknown[]);
      }
    } finally {
      stmt.free();
      insert.free();
    }
  };
  try {
    copyTable(
      `SELECT id, data, updatedAt FROM local_companies WHERE id = ?`,
      `INSERT OR REPLACE INTO local_companies(id, data, updatedAt) VALUES(?,?,?)`,
      3
    );
  } catch {
    /* ignore */
  }
  try {
    copyTable(
      `SELECT id, data, updatedAt FROM companies WHERE id = ?`,
      `INSERT OR REPLACE INTO companies(id, data, updatedAt) VALUES(?,?,?)`,
      3
    );
  } catch {
    /* ignore */
  }
  try {
    copyTable(
      `SELECT company_id, collection, id, data, updatedAt FROM company_docs WHERE company_id = ?`,
      `INSERT OR REPLACE INTO company_docs(company_id, collection, id, data, updatedAt) VALUES(?,?,?,?,?)`,
      5
    );
  } catch {
    /* ignore */
  }
  try {
    copyTable(
      `SELECT company_id, collection, id, doc_type, doc_date_ms, amount_value, updatedAt FROM company_docs_projection WHERE company_id = ?`,
      `INSERT OR REPLACE INTO company_docs_projection(company_id, collection, id, doc_type, doc_date_ms, amount_value, updatedAt) VALUES(?,?,?,?,?,?,?)`,
      7
    );
  } catch {
    /* ignore */
  }
  try {
    copyTable(
      `SELECT company_id, id, username, password_hash, display_name, role, created_at FROM company_users WHERE company_id = ?`,
      `INSERT OR REPLACE INTO company_users(company_id, id, username, password_hash, display_name, role, created_at) VALUES(?,?,?,?,?,?,?)`,
      7
    );
  } catch {
    /* ignore */
  }
  try {
    copyTable(
      `SELECT outbox_id, company_id, collection_name, doc_id, op, payload, created_at, client_write_id, nonce, payload_hash FROM sync_outbox WHERE company_id = ?`,
      `INSERT OR REPLACE INTO sync_outbox(outbox_id, company_id, collection_name, doc_id, op, payload, created_at, client_write_id, nonce, payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      10
    );
  } catch {
    try {
      copyTable(
        `SELECT outbox_id, company_id, collection_name, doc_id, op, payload, created_at FROM sync_outbox WHERE company_id = ?`,
        `INSERT OR REPLACE INTO sync_outbox(outbox_id, company_id, collection_name, doc_id, op, payload, created_at) VALUES(?,?,?,?,?,?,?)`,
        7
      );
    } catch {
      /* ignore */
    }
  }
  try {
    copyTable(
      `SELECT op_id, company_id, device_id, table_name, action, row_id, updated_at, op_seq, payload, synced_at FROM cloud_sync_outbox WHERE company_id = ?`,
      `INSERT OR REPLACE INTO cloud_sync_outbox(op_id, company_id, device_id, table_name, action, row_id, updated_at, op_seq, payload, synced_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      10
    );
  } catch {
    /* ignore */
  }
  try {
    copyTable(
      `SELECT company_id, last_local_op_seq, last_synced_op, last_sync_at, sync_status, last_error FROM cloud_sync_meta WHERE company_id = ?`,
      `INSERT OR REPLACE INTO cloud_sync_meta(company_id, last_local_op_seq, last_synced_op, last_sync_at, sync_status, last_error) VALUES(?,?,?,?,?,?)`,
      6
    );
  } catch {
    /* ignore */
  }
}

function deleteCompanyScopedRows(db: SqlJsDatabase, companyId: string): void {
  const cid = String(companyId).trim();
  if (!cid) return;
  const run = (sql: string) => {
    try {
      db.run(sql, [cid]);
    } catch {
      /* ignore */
    }
  };
  run(`DELETE FROM company_docs WHERE company_id = ?`);
  run(`DELETE FROM company_docs_projection WHERE company_id = ?`);
  run(`DELETE FROM company_users WHERE company_id = ?`);
  run(`DELETE FROM sync_outbox WHERE company_id = ?`);
  run(`DELETE FROM cloud_sync_outbox WHERE company_id = ?`);
  run(`DELETE FROM cloud_sync_meta WHERE company_id = ?`);
  run(`DELETE FROM local_companies WHERE id = ?`);
  run(`DELETE FROM companies WHERE id = ?`);
}

function copyAllAttachmentRefs(source: SqlJsDatabase, dest: SqlJsDatabase): void {
  try {
    const stmt = source.prepare(
      `SELECT scope, id, file_path, content_type, size, meta_json, updatedAt, sha256_hex FROM attachment_file_refs`
    );
    const insert = dest.prepare(
      `INSERT OR REPLACE INTO attachment_file_refs(scope, id, file_path, content_type, size, meta_json, updatedAt, sha256_hex) VALUES(?,?,?,?,?,?,?,?)`
    );
    try {
      while (stmt.step()) {
        insert.run(stmt.get() as unknown[]);
      }
    } finally {
      stmt.free();
      insert.free();
    }
  } catch {
    try {
      const stmt = source.prepare(
        `SELECT scope, id, file_path, content_type, size, meta_json, updatedAt FROM attachment_file_refs`
      );
      const insert = dest.prepare(
        `INSERT OR REPLACE INTO attachment_file_refs(scope, id, file_path, content_type, size, meta_json, updatedAt) VALUES(?,?,?,?,?,?,?)`
      );
      try {
        while (stmt.step()) {
          insert.run(stmt.get() as unknown[]);
        }
      } finally {
        stmt.free();
        insert.free();
      }
    } catch {
      /* ignore */
    }
  }
}

async function isNamespaceMigrationDone(): Promise<boolean> {
  try {
    const idb = await openIndexedDB(getScopedIdbName());
    const flag = await new Promise<unknown>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY_MIGRATED);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => idb.close();
    });
    return flag === "1" || flag === 1 || flag === true;
  } catch {
    return false;
  }
}

async function markNamespaceMigrationDone(): Promise<void> {
  await writeIdbKey(getScopedIdbName(), IDB_KEY_MIGRATED, "1");
}

/**
 * One-time split of legacy single SQLite blob into local / plservers / online folders.
 */
async function ensureSqliteNamespacesMigrated(SQL: typeof import("sql.js").default): Promise<void> {
  if (migrateNamespacesPromise) return migrateNamespacesPromise;
  migrateNamespacesPromise = (async () => {
    if (await isNamespaceMigrationDone()) return;

    const localExisting = await readIdbKey(getScopedIdbName(), idbKeyForNamespace("local"));
    const plExisting = await readIdbKey(getScopedIdbName(), idbKeyForNamespace("plservers"));
    const onlineExisting = await readIdbKey(getScopedIdbName(), idbKeyForNamespace("online"));
    // Fresh install already using namespaced keys — mark done without touching data.
    if (
      (localExisting && localExisting.byteLength > 64) ||
      (plExisting && plExisting.byteLength > 64) ||
      (onlineExisting && onlineExisting.byteLength > 64)
    ) {
      await markNamespaceMigrationDone();
      return;
    }

    const legacy = await loadDbFromIndexedDB("local");
    if (!legacy || legacy.byteLength <= 64) {
      await markNamespaceMigrationDone();
      return;
    }

    const source = new SQL.Database(new Uint8Array(legacy));
    initSchema(source);
    const dests: Record<SqliteStorageNamespace, SqlJsDatabase> = {
      local: new SQL.Database(),
      plservers: new SQL.Database(),
      online: new SQL.Database(),
    };
    for (const ns of SQLITE_STORAGE_NAMESPACES) initSchema(dests[ns]);

    const assigned = new Set<string>();
    const placeRoot = (table: "local_companies" | "companies") => {
      try {
        const stmt = source.prepare(`SELECT id, data, updatedAt FROM ${table}`);
        while (stmt.step()) {
          const row = stmt.getAsObject() as { id?: string; data?: string; updatedAt?: number };
          const id = String(row.id || "").trim();
          if (!id || assigned.has(id)) continue;
          const parsed = row.data ? parseCompanyJson(row.data) : null;
          const ns = resolveSqliteStorageNamespace(
            parsed
              ? ({ id, ...parsed } as Parameters<typeof resolveSqliteStorageNamespace>[0])
              : { id, storageOption: table === "local_companies" ? "local" : "firebase" }
          );
          assigned.add(id);
          writeCachedCompanySqliteNamespace(id, ns);
          copyCompanyScopedRows(source, dests[ns], id);
          // Ensure root lands in the correct registry table for that namespace.
          if (ns === "local" || table === "local_companies") {
            try {
              dests[ns].run(`DELETE FROM companies WHERE id = ?`, [id]);
            } catch {
              /* ignore */
            }
          }
        }
        stmt.free();
      } catch {
        /* ignore */
      }
    };
    placeRoot("local_companies");
    placeRoot("companies");

    // Orphan docs (no registry row) → local folder
    try {
      const stmt = source.prepare(`SELECT DISTINCT company_id FROM company_docs`);
      while (stmt.step()) {
        const row = stmt.getAsObject() as { company_id?: string };
        const id = String(row.company_id || "").trim();
        if (!id || assigned.has(id)) continue;
        assigned.add(id);
        writeCachedCompanySqliteNamespace(id, "local");
        copyCompanyScopedRows(source, dests.local, id);
      }
      stmt.free();
    } catch {
      /* ignore */
    }

    // Device-level attachment index: keep on local namespace (shared pending/offline refs).
    copyAllAttachmentRefs(source, dests.local);

    for (const ns of SQLITE_STORAGE_NAMESPACES) {
      await saveDbToIndexedDB(dests[ns].export(), ns);
      try {
        dests[ns].close();
      } catch {
        /* ignore */
      }
    }
    try {
      source.close();
    } catch {
      /* ignore */
    }
    await markNamespaceMigrationDone();
  })();
  try {
    await migrateNamespacesPromise;
  } catch (e) {
    migrateNamespacesPromise = null;
    throw e;
  }
}

async function openNamespaceDb(ns: SqliteStorageNamespace): Promise<BrowserDbWrapper | null> {
  if (typeof window === "undefined") return null;
  const hit = cachedByNs[ns];
  if (hit) return hit.wrapper;
  if (openPromiseByNs[ns]) return openPromiseByNs[ns]!;

  openPromiseByNs[ns] = (async () => {
    const initSqlJs = await getSqlJsCtor();
    const { publicAssetUrl } = await import("@/lib/webAppBasePath");
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        file.endsWith(".wasm") ? publicAssetUrl("/sql-wasm.wasm") : file,
    });
    await ensureSqliteNamespacesMigrated(SQL);

    const data = await loadDbFromIndexedDB(ns);
    const db = data ? new SQL.Database(new Uint8Array(data)) : new SQL.Database();
    initSchema(db);

    const save = () =>
      saveDbToIndexedDB(db.export(), ns).then(() => {
        void import("@/lib/liveDataFolderMirror")
          .then((m) => m.scheduleLiveDataFolderMirrorAfterFlush())
          .catch(() => undefined);
      });

    cachedByNs[ns] = {
      wrapper: null as unknown as BrowserDbWrapper,
      db,
      pendingSaveFn: save,
      pendingSaveTimer: null,
    };
    const wrapper = wrapDb(db, ns, save);
    cachedByNs[ns]!.wrapper = wrapper;
    if (!data) await save();
    return wrapper;
  })();

  try {
    return await openPromiseByNs[ns]!;
  } finally {
    openPromiseByNs[ns] = undefined;
  }
}

/** Open one storage folder (local | plservers | online). */
export async function getBrowserDbForNamespace(
  ns: SqliteStorageNamespace
): Promise<BrowserDbWrapper | null> {
  if (!isSqliteStorageNamespace(ns)) return null;
  return openNamespaceDb(ns);
}

/** Warm all three folders (bootstrap / flush). Returns local wrapper for legacy callers. */
export async function warmAllBrowserSqliteNamespaces(): Promise<BrowserDbWrapper | null> {
  let last: BrowserDbWrapper | null = null;
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    last = (await openNamespaceDb(ns)) || last;
  }
  return (await openNamespaceDb("local")) || last;
}

/**
 * Resolve which folder holds `companyId`, then open that DB.
 * Scans all folders on cache miss.
 */
export async function getBrowserDbForCompanyId(
  companyId: string
): Promise<BrowserDbWrapper | null> {
  const cid = String(companyId || "").trim();
  if (!cid) return getBrowserDbForNamespace("local");

  const cached = readCachedCompanySqliteNamespace(cid);
  if (cached) {
    const db = await getBrowserDbForNamespace(cached);
    if (db) {
      const hit =
        db.prepare(`SELECT id FROM local_companies WHERE id = ?`).get(cid) ||
        db.prepare(`SELECT id FROM companies WHERE id = ?`).get(cid) ||
        db.prepare(`SELECT company_id FROM company_docs WHERE company_id = ? LIMIT 1`).get(cid);
      if (hit) return db;
    }
  }

  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    const db = await getBrowserDbForNamespace(ns);
    if (!db) continue;
    const hit =
      db.prepare(`SELECT id FROM local_companies WHERE id = ?`).get(cid) ||
      db.prepare(`SELECT id FROM companies WHERE id = ?`).get(cid) ||
      db.prepare(`SELECT company_id FROM company_docs WHERE company_id = ? LIMIT 1`).get(cid);
    if (hit) {
      writeCachedCompanySqliteNamespace(cid, ns);
      return db;
    }
  }
  // New company: default to local until stamps say otherwise.
  writeCachedCompanySqliteNamespace(cid, "local");
  return getBrowserDbForNamespace("local");
}

/**
 * Move company root + docs + users + outboxes between folders (e.g. local → online on promote).
 */
export async function moveCompanySqliteNamespace(
  companyId: string,
  toNs: SqliteStorageNamespace
): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid || !isSqliteStorageNamespace(toNs)) return;
  const cachedNs = readCachedCompanySqliteNamespace(cid);
  if (cachedNs === toNs) return;
  await flushPendingBrowserDbSave();

  const fromDb = await getBrowserDbForCompanyId(cid);
  if (!fromDb) return;
  const fromNs = fromDb.namespace;
  if (fromNs === toNs) {
    writeCachedCompanySqliteNamespace(cid, toNs);
    return;
  }

  const toDb = await getBrowserDbForNamespace(toNs);
  if (!toDb) return;

  copyCompanyScopedRows(fromDb.raw, toDb.raw, cid);
  deleteCompanyScopedRows(fromDb.raw, cid);
  writeCachedCompanySqliteNamespace(cid, toNs);

  await saveDbToIndexedDB(fromDb.raw.export(), fromNs);
  await saveDbToIndexedDB(toDb.raw.export(), toNs);
}

/** Find company registry JSON across folders (includeDeleted handled by caller). */
export async function findCompanyRowAcrossNamespaces(
  companyId: string
): Promise<{ ns: SqliteStorageNamespace; id: string; data: string } | null> {
  const cid = String(companyId || "").trim();
  if (!cid) return null;
  const order: SqliteStorageNamespace[] = [];
  const cached = readCachedCompanySqliteNamespace(cid);
  if (cached) order.push(cached);
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    if (!order.includes(ns)) order.push(ns);
  }
  for (const ns of order) {
    const db = await getBrowserDbForNamespace(ns);
    if (!db) continue;
    const localRow = db.prepare(`SELECT id, data FROM local_companies WHERE id = ?`).get(cid) as
      | { id: string; data: string }
      | undefined;
    const row =
      localRow ??
      (db.prepare(`SELECT id, data FROM companies WHERE id = ?`).get(cid) as
        | { id: string; data: string }
        | undefined);
    if (row?.data) {
      writeCachedCompanySqliteNamespace(cid, ns);
      return { ns, id: row.id, data: row.data };
    }
  }
  return null;
}

/**
 * Browser me SQLite DB open karo.
 * Prefer `getBrowserDbForCompanyId` / `getBrowserDbForNamespace` for isolation.
 * No-arg form warms all folders and returns the local folder (bootstrap / attachment index).
 */
export async function getBrowserDb(): Promise<BrowserDbWrapper | null> {
  return warmAllBrowserSqliteNamespaces();
}

/** Cache clear karo (e.g. logout / switch data source / remote bridge write). */
export function clearBrowserDbCache(): void {
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    const cur = cachedByNs[ns];
    if (cur?.pendingSaveTimer) {
      clearTimeout(cur.pendingSaveTimer);
      cur.pendingSaveTimer = null;
    }
    delete cachedByNs[ns];
    delete openPromiseByNs[ns];
  }
}

/** Hidden bridge ne IndexedDB likha — app tab apna sql.js dubara IDB se load kare. */
export async function reloadBrowserDbFromIndexedDB(): Promise<BrowserDbWrapper | null> {
  clearBrowserDbCache();
  return warmAllBrowserSqliteNamespaces();
}

/** Debounced save pending ho to turant IndexedDB flush — refresh/tab close se company SQLite na ude. */
export async function flushPendingBrowserDbSave(): Promise<void> {
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    const cur = cachedByNs[ns];
    if (!cur) continue;
    if (cur.pendingSaveTimer) {
      clearTimeout(cur.pendingSaveTimer);
      cur.pendingSaveTimer = null;
    }
    if (cur.pendingSaveFn) {
      await cur.pendingSaveFn();
    } else {
      await saveDbToIndexedDB(cur.db.export(), ns);
    }
  }
  try {
    const { plPhase1bVerifyHook } = await import("@/lib/phase1bVerifyCapture");
    plPhase1bVerifyHook("onFlush");
  } catch {
    /* ignore */
  }
}

/** Voucher save hot path — debounced IndexedDB export; Save button / dialog mat roko. */
export function scheduleBrowserDbPersistAfterWrite(): void {
  if (typeof window === "undefined") return;
  if (isServerDataBridgeRenderer()) return;
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    const cur = cachedByNs[ns];
    if (!cur?.pendingSaveFn) continue;
    const fn = cur.pendingSaveFn;
    armDebouncedPersist(cur, () => fn());
  }
}

/** Restore / bulk write ke baad `reload` se pehle — `scheduleSave` async hai warna IndexedDB pura flush nahi hota */
export async function flushBrowserDbToIndexedDB(): Promise<void> {
  if (typeof window === "undefined") return;
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    const cur = cachedByNs[ns];
    if (!cur) continue;
    await saveDbToIndexedDB(cur.db.export(), ns);
  }
}

export { clearCachedCompanySqliteNamespace, companyIdsInDb };
