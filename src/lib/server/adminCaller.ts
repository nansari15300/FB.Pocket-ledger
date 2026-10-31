import "server-only";

import admin from "firebase-admin";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import {
  PB_BEARER_PREFIX,
  pocketBaseServerUrlForApi,
  verifyPocketBaseBearer,
} from "@/lib/localCloudSync/server/pbBearerAuth";
import { bearerFromRequest } from "@/lib/server/billingCaller";
import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import { pbBillingDb, pbBillingReady } from "@/lib/server/pbBilling/pbBillingDb";

/**
 * Caller of a SuperAdmin API route.
 * - `Bearer plpb.<token>` (Pocket Ledger Server login): must be the server's main admin
 *   (`GET /api/pl/admin/check`); documents are read / written on the server (PocketBase).
 * - Firebase ID token: legacy fallback, kept only while old Firebase admin accounts still exist.
 */
export type AdminCallerResult =
  | { ok: true; uid: string; email: string | undefined; db: admin.firestore.Firestore; store: "server" | "firebase"; status?: undefined; error?: undefined }
  | { ok: false; status: number; error: string; uid?: undefined; email?: undefined; db?: undefined; store?: undefined };

async function serverMainAdminOk(token: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${pocketBaseServerUrlForApi()}/api/pl/admin/check`, {
      method: "GET",
      headers: { Authorization: token.slice(PB_BEARER_PREFIX.length) },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 200) return true;
    if (res.status === 401 || res.status === 403) return false;
    return null;
  } catch {
    return null;
  }
}

export async function resolveSuperAdminCaller(req: Request): Promise<AdminCallerResult> {
  const token = bearerFromRequest(req);
  if (!token) return { ok: false, status: 401, error: "Missing Authorization Bearer token" };

  if (token.startsWith(PB_BEARER_PREFIX)) {
    const v = await verifyPocketBaseBearer(token);
    if ("error" in v) return { ok: false, status: v.status, error: v.error };
    const isAdmin = await serverMainAdminOk(token);
    if (isAdmin === null) return { ok: false, status: 503, error: "Pocket Ledger Server not reachable" };
    if (!isAdmin) return { ok: false, status: 403, error: "SuperAdmin only" };
    if (!pbBillingReady()) {
      return {
        ok: false,
        status: 503,
        error: "Server billing is not linked: set PL_HOSTING_KEY in the app (Hosting settings > App link key).",
      };
    }
    return { ok: true, uid: v.uid, email: v.email ?? undefined, db: pbBillingDb(), store: "server" };
  }

  if (!isFirebaseAdminConfigured()) {
    return { ok: false, status: 503, error: "Firebase Admin is not configured on this server." };
  }
  const db = getAdminDb();
  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return { ok: false, status: 401, error: "Invalid auth token" };
  }
  if (!(await isSuperAdminServer(decoded.uid, decoded.email ?? undefined))) {
    return { ok: false, status: 403, error: "SuperAdmin only" };
  }
  return { ok: true, uid: decoded.uid, email: decoded.email ?? undefined, db, store: "firebase" };
}