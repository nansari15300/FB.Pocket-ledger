import "server-only";

/**
 * Loose stand-in for former firebase-admin types. Runtime DB is pbBillingDb (PocketBase).
 */

import type { Timestamp as PbTimestamp } from "@/lib/server/pbBilling/fieldValue";

namespace admin {
  export namespace firestore {
    // Intentionally `any` so existing Admin-shaped call sites keep compiling.
    export type Firestore = any;
    export type DocumentReference = any;
    export type CollectionReference = any;
    export type Query = any;
    export type QuerySnapshot = any;
    export type QueryDocumentSnapshot = any;
    export type DocumentSnapshot = any;
    export type DocumentData = Record<string, unknown>;
    export type WriteBatch = any;
    export type FieldValue = any;
    export type FieldPath = any;
    export type Timestamp = PbTimestamp;
  }
  export namespace auth {
    export type DecodedIdToken = {
      uid: string;
      email?: string;
      [key: string]: unknown;
    };
  }
}

export default admin;
