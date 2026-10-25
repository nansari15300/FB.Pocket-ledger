"use client";

/**
 * Recovery mode (desktop app, server main admin only): read-only view of every company that is
 * in this PC's local SQLite (all three storage folders, every user that ever signed in here).
 * Unlike the normal company list there is no per-session filter. Nothing here writes.
 */

import { SQLITE_STORAGE_NAMESPACES, type SqliteStorageNamespace } from "@/lib/sqliteStorageNamespace";

export type RecoveryCompany = {
  id: string;
  name: string;
  ownerEmail: string;
  ownerId: string;
  /** Root company JSON (newest copy across folders). */
  data: Record<string, unknown>;
  updatedAt: number;
  deleted: boolean;
  namespaces: SqliteStorageNamespace[];
  /** Records per collection (unique ids across folders). */
  counts: Record<string, number>;
  totalRecords: number;
  hasPassword: boolean;
  members: Array<{ email: string; role: string; hasPassword: boolean }>;
};

export type RecoveryDoc = { coll: string; id: string; data: Record<string, unknown>; at: number };

type Row = Record<string, unknown>;

async function openAll() {
  const { getBrowserDbForNamespace, flushPendingBrowserDbSave } = await import("@/lib/localSqlite");
  try {
    await flushPendingBrowserDbSave();
  } catch {
    /* read what is there */
  }
  const out: Array<{ ns: SqliteStorageNamespace; db: NonNullable<Awaited<ReturnType<typeof getBrowserDbForNamespace>>> }> = [];
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    try {
      const db = await getBrowserDbForNamespace(ns);
      if (db) out.push({ ns, db });
    } catch {
      /* folder not readable: skip */
    }
  }
  return out;
}

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function membersOf(data: Record<string, unknown>, ownerEmail: string): RecoveryCompany["members"] {
  const list = Array.isArray(data.sharedWith) ? data.sharedWith : [];
  const seen = new Set<string>();
  const out: RecoveryCompany["members"] = [];
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const email = str(r.email).toLowerCase();
    if (!email || email === ownerEmail || seen.has(email)) continue;
    seen.add(email);
    const pw = [r.password, r.pass, r.pwd].find((x) => typeof x === "string" && x);
    out.push({ email, role: str(r.role) || "viewer", hasPassword: !!pw });
  }
  return out;
}

/** Every company in this PC's SQLite (companies + local_companies, all folders), newest copy wins. */
export async function listAllSqliteCompanies(): Promise<RecoveryCompany[]> {
  const dbs = await openAll();
  const byId = new Map<string, RecoveryCompany>();
  for (const { ns, db } of dbs) {
    for (const table of ["companies", "local_companies"]) {
      let rows: Row[] = [];
      try {
        rows = db.prepare(`SELECT id, data, updatedAt FROM ${table}`).all() as Row[];
      } catch {
        continue;
      }
      for (const r of rows) {
        const id = str(r.id);
        const data = parseJson(r.data);
        if (!id || !data) continue;
        const at = Number(r.updatedAt) || 0;
        const prev = byId.get(id);
        if (prev) {
          if (!prev.namespaces.includes(ns)) prev.namespaces.push(ns);
          if (at <= prev.updatedAt) continue;
        }
        const ownerEmail = str(data.ownerEmail).toLowerCase();
        const pw = data.password;
        byId.set(id, {
          id,
          name: str(data.name) || id,
          ownerEmail,
          ownerId: str(data.ownerId),
          data,
          updatedAt: at,
          deleted: data.isDeleted === true || data.deleted === true,
          namespaces: prev ? prev.namespaces : [ns],
          counts: {},
          totalRecords: 0,
          hasPassword: typeof pw === "string" && pw.length > 0,
          members: membersOf(data, ownerEmail),
        });
      }
    }
  }
  // record counts: unique (collection, id) across folders
  const keys = new Map<string, Map<string, Set<string>>>();
  for (const { db } of dbs) {
    let rows: Row[] = [];
    try {
      rows = db.prepare("SELECT company_id, collection, id FROM company_docs").all() as Row[];
    } catch {
      continue;
    }
    for (const r of rows) {
      const cid = str(r.company_id);
      if (!byId.has(cid)) continue;
      const colls = keys.get(cid) ?? new Map<string, Set<string>>();
      const coll = str(r.collection);
      const ids = colls.get(coll) ?? new Set<string>();
      ids.add(str(r.id));
      colls.set(coll, ids);
      keys.set(cid, colls);
    }
  }
  for (const [cid, colls] of keys) {
    const c = byId.get(cid)!;
    for (const [coll, ids] of colls) {
      c.counts[coll] = ids.size;
      c.totalRecords += ids.size;
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * All records of one company (newest copy across folders), sorted by collection + id so a resumed
 * upload sends the same batches in the same order.
 */
export async function readCompanyDocs(companyId: string): Promise<RecoveryDoc[]> {
  const dbs = await openAll();
  const best = new Map<string, RecoveryDoc>();
  for (const { db } of dbs) {
    let rows: Row[] = [];
    try {
      rows = db
        .prepare("SELECT collection, id, data, updatedAt FROM company_docs WHERE company_id = ?")
        .all(companyId) as Row[];
    } catch {
      continue;
    }
    for (const r of rows) {
      const coll = str(r.collection);
      const id = str(r.id);
      const data = parseJson(r.data);
      if (!coll || !id || !data) continue;
      const at = Number(r.updatedAt) || 0;
      const key = `${coll}/${id}`;
      const prev = best.get(key);
      if (prev && prev.at >= at) continue;
      best.set(key, { coll, id, data, at });
    }
  }
  return Array.from(best.values()).sort((a, b) =>
    a.coll === b.coll ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.coll < b.coll ? -1 : 1
  );
}