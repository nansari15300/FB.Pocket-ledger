"use client";

/**
 * HR attendance / leaves / payroll storage — PocketBase `pl_docs` (same pattern as loans, `writeLoanEntity`):
 * SQLite-first local write (`force: true`) → `sync_outbox` → background sync.
 * App collections `hr_attendance`, `hr_leaves`, `hr_payroll` map to `pl_docs` (key = collection name)
 * via `pbTargetForAppCollection`, so they round-trip to other devices with the normal company pull.
 */

import {
  BROWSER_DB_COLLECTION_BUMP,
  getCompanyDocFromBrowserDb,
  listCompanyDocsFromBrowserDb,
  upsertCompanyDocInBrowserDb,
} from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox, type VoucherOutboxOp } from "@/lib/localVoucherOutbox";
import { pbDeviceId } from "@/lib/pocketbaseData/pbSync";
import type { HrAttendance, HrLeave, HrPayroll } from "../types";

export const HR_DOC_COLLECTIONS = {
  attendance: "hr_attendance",
  leaves: "hr_leaves",
  payroll: "hr_payroll",
} as const;

export type HrDocKind = keyof typeof HR_DOC_COLLECTIONS;

export type HrDocByKind = {
  attendance: HrAttendance;
  leaves: HrLeave;
  payroll: HrPayroll;
};

/** Write input: meta fields (updatedAtMs / deviceId / companyId) are stamped here. */
export type HrDocWriteInput<K extends HrDocKind> = Omit<HrDocByKind[K], "updatedAtMs" | "deviceId" | "deleted"> & {
  updatedAtMs?: number;
  deviceId?: string;
};

/** Random id: `<prefix>_<20 chars>` (leaves use `lv_…`). */
export function newHrDocId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const bytes = new Uint8Array(20);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

function safeDeviceId(): string | undefined {
  try {
    const id = pbDeviceId();
    return id ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

function isRowDeleted(row: Record<string, unknown>): boolean {
  return row.isDeleted === true || row.deleted === true;
}

function normalizeRow<K extends HrDocKind>(row: Record<string, unknown>): HrDocByKind[K] {
  const id = String(row.app_id || row.id || "");
  return { ...row, app_id: id, updatedAtMs: Number(row.updatedAtMs || 0) } as unknown as HrDocByKind[K];
}

/** All live (not deleted) docs of one HR collection for this company, from the local browser DB. */
export async function listHrDocs<K extends HrDocKind>(companyId: string, kind: K): Promise<HrDocByKind[K][]> {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  const rows = (await listCompanyDocsFromBrowserDb(cid, HR_DOC_COLLECTIONS[kind], { forBackupMerge: true })) as
    | Record<string, unknown>[]
    | null;
  return (rows || [])
    .filter((r) => r && typeof r === "object")
    .filter((r) => !r.companyId || String(r.companyId) === cid)
    .filter((r) => !isRowDeleted(r))
    .map((r) => normalizeRow<K>(r));
}

/** One HR doc by id (null when missing or deleted). */
export async function getHrDoc<K extends HrDocKind>(
  companyId: string,
  kind: K,
  docId: string
): Promise<HrDocByKind[K] | null> {
  const cid = String(companyId || "").trim();
  const id = String(docId || "").trim();
  if (!cid || !id) return null;
  const row = await getCompanyDocFromBrowserDb(cid, HR_DOC_COLLECTIONS[kind], id);
  if (!row || isRowDeleted(row)) return null;
  return normalizeRow<K>(row);
}

/**
 * Upsert HR docs (merge with the existing local doc). Same gate as loans:
 * PL Server staff offline policy → SQLite upsert (force) → outbox create/update.
 * Returns the number of docs written. Throws on the first failure.
 */
export async function writeHrDocs<K extends HrDocKind>(
  companyId: string,
  kind: K,
  records: HrDocWriteInput<K>[]
): Promise<number> {
  const cid = String(companyId || "").trim();
  if (!cid) throw new Error("HR: company id is missing.");
  const list = (records || []).filter((r) => r && String(r.app_id || "").trim());
  if (list.length === 0) return 0;

  const { assertPlServerStaffWriteAllowed } = await import("@/lib/plServerStaffOfflinePolicy");
  await assertPlServerStaffWriteAllowed(cid);

  const coll = HR_DOC_COLLECTIONS[kind];
  const deviceId = safeDeviceId();
  let count = 0;
  for (const rec of list) {
    const id = String(rec.app_id).trim();
    const existing = await getCompanyDocFromBrowserDb(cid, coll, id);
    const merged: Record<string, unknown> = {
      ...(existing || {}),
      ...(rec as unknown as Record<string, unknown>),
      id,
      app_id: id,
      companyId: cid,
      updatedAtMs: Date.now(),
      isDeleted: false,
      deleted: false,
    };
    if (deviceId) merged.deviceId = deviceId;
    const persisted = await upsertCompanyDocInBrowserDb(cid, coll, id, merged, {
      force: true,
      skipPlanMutationGate: true,
    });
    if (!persisted) throw new Error("Could not save to the local database.");
    const op: VoucherOutboxOp = existing ? "update" : "create";
    await enqueueCompanyDocOutbox(cid, coll, op, id, merged);
    count += 1;
  }
  return count;
}

/**
 * Delete HR docs by id, through the same path as writeHrDocs: the local doc keeps all its fields and gets
 * `isDeleted` / `deleted` = true (tombstone), then SQLite upsert (force) and outbox "update", so the delete syncs to
 * other devices like any other change and the data can still be restored. Missing or already deleted ids are
 * skipped. Returns the number of docs deleted. Throws on the first failure.
 */
export async function deleteHrDocs(companyId: string, kind: HrDocKind, ids: string[]): Promise<number> {
  const cid = String(companyId || "").trim();
  if (!cid) throw new Error("HR: company id is missing.");
  const list = Array.from(new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (list.length === 0) return 0;

  const { assertPlServerStaffWriteAllowed } = await import("@/lib/plServerStaffOfflinePolicy");
  await assertPlServerStaffWriteAllowed(cid);

  const coll = HR_DOC_COLLECTIONS[kind];
  const deviceId = safeDeviceId();
  let count = 0;
  for (const id of list) {
    const existing = await getCompanyDocFromBrowserDb(cid, coll, id);
    if (!existing || isRowDeleted(existing)) continue;
    const now = Date.now();
    const merged: Record<string, unknown> = {
      ...existing,
      id,
      app_id: id,
      companyId: cid,
      updatedAtMs: now,
      deletedAtMs: now,
      isDeleted: true,
      deleted: true,
    };
    if (deviceId) merged.deviceId = deviceId;
    const persisted = await upsertCompanyDocInBrowserDb(cid, coll, id, merged, {
      force: true,
      skipPlanMutationGate: true,
    });
    if (!persisted) throw new Error("Could not delete from the local database.");
    await enqueueCompanyDocOutbox(cid, coll, "update", id, merged);
    count += 1;
  }
  return count;
}

/** Calls `onChange` when one of the given HR collections changes in the local browser DB (local write or sync pull). */
export function subscribeHrDocs(companyId: string, kinds: HrDocKind[], onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const cid = String(companyId || "").trim();
  const colls = new Set<string>(kinds.map((k) => HR_DOC_COLLECTIONS[k]));
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<{ companyId?: string; collection?: string }>).detail || {};
    if (detail.companyId && cid && String(detail.companyId) !== cid) return;
    if (detail.collection && !colls.has(String(detail.collection))) return;
    onChange();
  };
  window.addEventListener(BROWSER_DB_COLLECTION_BUMP, handler);
  return () => window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, handler);
}
