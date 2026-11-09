import "server-only";

/**
 * Firestore value sentinels without the Firebase Admin SDK.
 *
 * Every plan/billing document already lives on the Pocket Ledger Server; only the *shape* of
 * `admin.firestore.FieldValue` / `admin.firestore.Timestamp` is still needed by the billing helpers,
 * which receive `serverDb()` (a PocketBase-backed, Firestore-shaped adapter). `pbBillingDb.encodeValue`
 * reads `methodName` / `operand` / `elements` and turns these objects into server-side operations.
 *
 * Importing `firebase-admin` just for these sentinels pulled the whole Admin SDK into the server
 * bundle, so they live here instead.
 */

type Sentinel = { methodName: string };

function sentinel(methodName: string, extra?: Record<string, unknown>): Sentinel {
  return { methodName: `FieldValue.${methodName}`, ...(extra || {}) };
}

/** `FieldValue.serverTimestamp()` — stored as the server's own current time. */
export function serverTimestamp(): Sentinel {
  return sentinel("serverTimestamp");
}

/** `FieldValue.delete()` — removes the field on merge writes. */
export function deleteField(): Sentinel {
  return sentinel("delete");
}

/** `FieldValue.increment(n)` — atomic counter update. */
export function increment(n: number): Sentinel {
  return sentinel("increment", { operand: n });
}

/** `FieldValue.arrayUnion(...)` — atomic array append. */
export function arrayUnion(...elements: unknown[]): Sentinel {
  return sentinel("arrayUnion", { elements });
}

/** `FieldValue.arrayRemove(...)` — atomic array removal. */
export function arrayRemove(...elements: unknown[]): Sentinel {
  return sentinel("arrayRemove", { elements });
}

/**
 * `admin.firestore.Timestamp` stand-in: same fields and factory helpers the billing code calls.
 * The PB adapter converts it to the same `{__fsTs}` JSON the app sync already uses.
 */
export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  constructor(seconds: number, nanoseconds: number) {
    this.seconds = Math.trunc(seconds) || 0;
    this.nanoseconds = Math.max(0, Math.min(999_999_999, Math.trunc(nanoseconds) || 0));
  }
  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }
  static fromMillis(ms: number): Timestamp {
    const safe = Number.isFinite(ms) ? ms : Date.now();
    return new Timestamp(Math.floor(safe / 1000), (safe % 1000) * 1e6);
  }
  static fromDate(d: Date): Timestamp {
    return Timestamp.fromMillis(d.getTime());
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate(): Date {
    return new Date(this.toMillis());
  }
  isEqual(other: Timestamp): boolean {
    return this.seconds === other.seconds && this.nanoseconds === other.nanoseconds;
  }
}

/**
 * Adapter-friendly `FieldPath.documentId()`.
 *
 * The PB adapter only checks that the value is not a plain string and carries a `documentId`
 * marker, so this doubles as the Admin SDK's `FieldPath` in call sites whose variables are still
 * typed as `admin.firestore.Query`.
 */
class PbFieldPath {
  readonly methodName = "FieldPath.documentId";
  readonly documentId = true;
}

/** `admin.firestore.FieldPath.documentId()` equivalent. */
export const FieldPath = {
  documentId(): PbFieldPath {
    return new PbFieldPath();
  },
};
