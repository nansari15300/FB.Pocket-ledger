import "server-only";

import { createHash } from "crypto";

/**
 * Drive API bearer from a Pocket Ledger Server login (`pl_users`, no Firebase session):
 * `Authorization: Bearer plpb.<server token>`. The token is checked against the server itself
 * (the user's own `pl_users` record must load with it and not be disabled).
 * uid = the record's `app_uid` (migrated Firebase account, set only by the admin / migration)
 * or `pb_<record id>`.
 */

export const PB_BEARER_PREFIX = "plpb.";

const CACHE_MS = 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: PbBearerResult }>();

export type PbBearerResult = { uid: string; email: string | null } | { error: string; status: number };

export function pocketBaseServerUrlForApi(): string {
  const raw = String(process.env.PL_POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || "").trim();
  return (raw || "http://127.0.0.1:8090").replace(/\/+$/, "");
}

function jwtClaims(token: string): { id: string; collectionId: string } | null {
  try {
    const part = token.split(".")[1] || "";
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const p = JSON.parse(json) as { id?: unknown; type?: unknown; exp?: unknown; collectionId?: unknown };
    if (p.type !== "auth") return null;
    if (typeof p.exp === "number" && p.exp * 1000 < Date.now()) return null;
    if (typeof p.id !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(p.id)) return null;
    return { id: p.id, collectionId: typeof p.collectionId === "string" ? p.collectionId : "" };
  } catch {
    return null;
  }
}

export async function verifyPocketBaseBearer(
  bearer: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = pocketBaseServerUrlForApi()
): Promise<PbBearerResult> {
  const token = bearer.startsWith(PB_BEARER_PREFIX) ? bearer.slice(PB_BEARER_PREFIX.length) : "";
  const claims = token ? jwtClaims(token) : null;
  if (!claims) return { error: "Invalid auth token", status: 401 };
  const id = claims.id;
  const key = createHash("sha256").update(token).digest("hex");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: PbBearerResult;
  try {
    const res = await fetchImpl(`${baseUrl}/api/collections/pl_users/records/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Authorization: token },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      value = { error: "Invalid auth token", status: 401 };
    } else if (!res.ok) {
      // Server trouble: do not cache.
      return { error: "Pocket Ledger Server not reachable", status: 503 };
    } else {
      const rec = (await res.json()) as Record<string, unknown>;
      // Same record and a token issued for this collection (not another auth collection).
      if (String(rec?.id || "") !== id || !claims.collectionId || String(rec.collectionId || "") !== claims.collectionId) value = { error: "Invalid auth token", status: 401 };
      else if (rec.disabled === true) value = { error: "Account disabled", status: 403 };
      else {
        const appUid = String(rec.app_uid || "").trim();
        const email = String(rec.email || "").trim().toLowerCase() || null;
        value = { uid: appUid || `pb_${id}`, email };
      }
    }
  } catch {
    return { error: "Pocket Ledger Server not reachable", status: 503 };
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
