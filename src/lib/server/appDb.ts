import "server-only";

import type admin from "firebase-admin";
import { pbBillingDb } from "@/lib/server/pbBilling/pbBillingDb";

/**
 * Document store for hosted-API routes that are not tied to a signed-in caller (public plan catalog,
 * gateway status, payment gateway keys, ...). It is ALWAYS the Pocket Ledger Server (PocketBase,
 * `pl_billing_docs` via the key-gated `/api/pl/billing/*` endpoints, key = PL_HOSTING_KEY).
 * There is no Firebase fallback: when the server is not linked, reads fail with a clear
 * "Server billing is not linked" error and the routes answer with their built-in defaults.
 * (The return type is only the Firestore-shaped interface the billing helpers were written for.)
 */
export function serverDb(): admin.firestore.Firestore {
  return pbBillingDb();
}