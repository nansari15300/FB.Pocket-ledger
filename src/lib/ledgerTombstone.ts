"use client";

/**
 * Static/APK local-first: hard `deleteDoc` ki jagah soft tombstone + outbox `delete` op.
 * `deletedAt` / `isDeleted` / `deletedBy` existing recycler patterns se align (`voucherActionsClient`).
 */

import { Timestamp } from "@/lib/pbCompat/firestore";
import { auth } from "@/lib/firebase";

const DEVICE_STORAGE_KEY = "pl_ledger_device_id_v1";

/** Multi-device sync debug: konsi device ne tombstone lagaya. */
export function getLedgerDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let v = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (!v) {
      v =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      window.localStorage.setItem(DEVICE_STORAGE_KEY, v);
    }
    return v;
  } catch {
    return "no-storage";
  }
}

/** Outbox replay / support: har delete mutation ka stable client id (Firestore idem subdoc). */
export function newLedgerDeleteOpId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `del_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Company subcollection row par soft-delete patch — SQLite + server dono JSON-safe Timestamp.
 * `deletedBy`: Firebase uid preferred, warna device id (guest / synthetic auth).
 */
export function buildLedgerTombstoneFields(docId: string): Record<string, unknown> {
  const uid = auth?.currentUser?.uid?.trim() || "";
  return {
    id: docId,
    isDeleted: true,
    deletedAt: Timestamp.now(),
    deletedBy: uid || getLedgerDeviceId(),
    plLedgerDeleteOpId: newLedgerDeleteOpId(),
    plLedgerDeletedByDevice: getLedgerDeviceId(),
  };
}
