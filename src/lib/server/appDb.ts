import "server-only";

import type admin from "firebase-admin";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { pbBillingDb, pbBillingReady } from "@/lib/server/pbBilling/pbBillingDb";

/**
 * Document store for hosted-API routes that are not tied to a signed-in caller (public plan catalog,
 * gateway status, ...). The Pocket Ledger Server (PocketBase) is the store when the app link key
 * (PL_HOSTING_KEY) is set; the Firestore Admin SDK is only the fallback while it is not.
 */
export function serverDb(): admin.firestore.Firestore {
  return pbBillingReady() ? pbBillingDb() : getAdminDb();
}