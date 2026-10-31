/**
 * General (non-company) documents on the Pocket Ledger Server: users, messages, notifications,
 * app settings, distributor applications, inter-company records, devices ...
 * Server side: pb_hooks/lib/udoc.js (`/api/pl/udoc/get|list|write`). Used in a server login
 * (pl_users) instead of Firestore; reads go through pbReadSeam, writes through the write gateway.
 */

import { isPocketBaseAppSessionActive } from "@/lib/pocketbaseData/pbAppSession";
import { PocketBaseRequestError, pbRequest } from "@/lib/pocketbaseData/pbClient";
import { decodeDocFromPocketBase, encodeWriteForPocketBase, type PbFieldOp } from "@/lib/pocketbaseData/pbSync";

/** Top-level collections the general document store serves. */
export const USER_GLOBAL_ROOTS = new Set([
  "users",
  "app_settings",
  "config",
  "payments",
  "activity_logs",
  "conversations",
  "admin_notifications",
  "distributor_applications",
  "inter_company_system_names",
  "inter_company_public_profiles",
  "inter_company_groups",
  "inter_company_system_join_requests",
  "inter_company_public_system_links",
  "reconciliation_shares",
  "devices",
  "user_tokens",
]);

export type UdocOp = "set" | "merge" | "update" | "create" | "delete";
export type UdocWrite = { path: string; op: UdocOp; data?: Record<string, unknown>; fieldOps?: PbFieldOp[] };

function pathParts(ref: unknown): string[] {
  return String((ref as { path?: unknown } | null)?.path || "").split("/").filter(Boolean);
}

/** Document path when `ref` is a general doc served by the server in this (server) login, else null. */
export function udocDocPath(ref: unknown): string | null {
  try {
    if (!isPocketBaseAppSessionActive()) return null;
  } catch {
    return null;
  }
  const p = pathParts(ref);
  if (!p.length || p.length % 2 !== 0 || !USER_GLOBAL_ROOTS.has(p[0])) return null;
  return p.join("/");
}

/** Collection path (for addDoc) when served by the general document store, else null. */
export function udocCollectionPath(ref: unknown): string | null {
  try {
    if (!isPocketBaseAppSessionActive()) return null;
  } catch {
    return null;
  }
  const p = pathParts(ref);
  if (!p.length || p.length % 2 !== 1 || !USER_GLOBAL_ROOTS.has(p[0])) return null;
  return p.join("/");
}

function toError(e: unknown): Error {
  if (e instanceof PocketBaseRequestError) {
    const code = e.status === 403 ? "permission-denied" : e.status === 404 ? "not-found" : e.status === 409 ? "already-exists" : "unavailable";
    const body = e.data as { message?: unknown } | null;
    const msg = e.status === 403 ? "Missing or insufficient permissions." : String(body?.message || e.message);
    return Object.assign(new Error(msg), { code, name: "FirebaseError" });
  }
  return e instanceof Error ? e : new Error(String(e));
}

export function makeUdocWrite(path: string, op: UdocOp, data?: Record<string, unknown> | null): UdocWrite {
  if (op === "delete") return { path, op };
  const mode = op === "update" ? "update" : op === "merge" ? "merge" : "set";
  const enc = encodeWriteForPocketBase(data || {}, mode);
  return { path, op, data: enc.data, fieldOps: enc.fieldOps };
}

export async function udocCommit(writes: UdocWrite[]): Promise<void> {
  if (!writes.length) return;
  try {
    await pbRequest("/api/pl/udoc/write", { method: "POST", body: { writes }, timeoutMs: 30_000 });
  } catch (e) {
    throw toError(e);
  }
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("pl-udoc-written"));
  } catch {
    /* ignore */
  }
}

export async function udocReadDoc(path: string): Promise<{ exists: boolean; data: Record<string, unknown> | null }> {
  try {
    const r = (await pbRequest("/api/pl/udoc/get", { method: "POST", body: { paths: [path] }, timeoutMs: 20_000 })) as {
      docs?: { exists?: unknown; data?: unknown; denied?: unknown }[];
    };
    const d = Array.isArray(r?.docs) ? r.docs[0] : null;
    if (d && d.denied === true) {
      throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied", name: "FirebaseError" });
    }
    if (d && d.exists === true) return { exists: true, data: decodeDocFromPocketBase(d.data) };
    return { exists: false, data: null };
  } catch (e) {
    throw toError(e);
  }
}