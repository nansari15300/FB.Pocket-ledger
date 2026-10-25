import "server-only";

import admin from "firebase-admin";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import { PB_BEARER_PREFIX, verifyPocketBaseBearer } from "@/lib/localCloudSync/server/pbBearerAuth";
import { pbBillingDb, pbBillingReady } from "@/lib/server/pbBilling/pbBillingDb";

/**
 * Who is calling a plan / billing route, and which store holds their companies:
 * - `Bearer plpb.<token>` (Pocket Ledger Server login) -> server billing store (PocketBase)
 * - Firebase ID token (older accounts / companies) -> Firestore, unchanged
 */
export type BillingStore = "firebase" | "server";

export type BillingCaller = {
  decoded: admin.auth.DecodedIdToken;
  db: admin.firestore.Firestore;
  store: BillingStore;
};

// every member names every key: the project is not "strict", so `if (!r.ok)` does not narrow a plain union
export type BillingCallerResult =
  | ({ ok: true; status?: undefined; error?: undefined } & BillingCaller)
  | { ok: false; status: number; error: string; decoded?: undefined; db?: undefined; store?: undefined };

/** Stripe metadata value that marks a checkout made for a server company. */
export const BILLING_STORE_META_KEY = "plStore";

export function bearerFromRequest(req: Request): string {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

export function isServerBillingBearer(token: string): boolean {
  return token.startsWith(PB_BEARER_PREFIX);
}

const SERVER_NOT_LINKED =
  "Server billing is not linked: set PL_HOSTING_KEY in the app (Hosting settings > App link key).";

export async function resolveBillingCallerFromToken(token: string): Promise<BillingCallerResult> {
  if (!token) return { ok: false, status: 401, error: "Missing Authorization Bearer token" };
  if (isServerBillingBearer(token)) {
    const v = await verifyPocketBaseBearer(token);
    if ("error" in v) return { ok: false, status: v.status, error: v.error };
    if (!pbBillingReady()) return { ok: false, status: 503, error: SERVER_NOT_LINKED };
    const decoded = {
      uid: v.uid,
      sub: v.uid,
      email: v.email ?? undefined,
      email_verified: true,
      firebase: { sign_in_provider: "pl_server", identities: {} },
    } as unknown as admin.auth.DecodedIdToken;
    return { ok: true, decoded, db: pbBillingDb(), store: "server" };
  }
  if (!isFirebaseAdminConfigured()) {
    return { ok: false, status: 503, error: "Firebase Admin is not configured on this server." };
  }
  const db = getAdminDb();
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { ok: true, decoded, db, store: "firebase" };
  } catch {
    return { ok: false, status: 401, error: "Invalid auth token" };
  }
}

export async function resolveBillingCaller(req: Request): Promise<BillingCallerResult> {
  return resolveBillingCallerFromToken(bearerFromRequest(req));
}

/** Store for a checkout / webhook from its metadata (`plStore: "server"`), default Firebase. */
export function billingStoreFromMeta(meta: Record<string, unknown> | null | undefined): BillingStore {
  return String(meta?.[BILLING_STORE_META_KEY] ?? "").trim() === "server" ? "server" : "firebase";
}

export function billingDbForStore(store: BillingStore): admin.firestore.Firestore {
  return store === "server" ? pbBillingDb() : getAdminDb();
}

/**
 * Routes that never required auth (initiate / addon-checkout): a `Bearer plpb.` header switches them to the
 * server store (and must verify); without it they keep the old Firebase behaviour unchanged.
 */
export async function optionalServerBillingCaller(req: Request): Promise<BillingCallerResult | null> {
  const token = bearerFromRequest(req);
  if (!isServerBillingBearer(token)) return null;
  return resolveBillingCallerFromToken(token);
}
