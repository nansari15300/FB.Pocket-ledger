"use client";

/**
 * Browser SQLite `company_docs` mirror ke liye: kaunsi row pehle Firestore snapshot / server confirm se aayi
 * (extras merge me "ghost" restore na ban sake jab server pe doc hard-delete ho chuka ho).
 * KEY sirf local JSON me rakho — Firestore paths par kabhi persist mat karna.
 */
export const LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY = "__mirrorBackedByFirestore" as const;

/**
 * Sirf SQLite + outbox — Firestore kabhi persist mat (`flushVoucherOutbox` hatata hai).
 * Sync‑3 offline create lineage: conflicting merge / diagnostics ke liye device pe first persist epoch.
 */
export const PL_CLIENT_OFFLINE_FIRST_PERSIST_MS = "__plOfflineFirstPersistMs" as const;

/** Firestore se aaya hua row SQLite mirror me — server orphan purge ke liye pehchan. */
/**
 * Transient marker set by snapshot readers when `doc.metadata.hasPendingWrites` (SDK latency-compensated local write,
 * not yet acknowledged by the server). Such rows must NOT be stamped as server-backed. Never persisted.
 */
export const PL_SDK_PENDING_WRITE_KEY = "__plSdkPendingWrite" as const;

export function stampLocalMirrorBackedByFirestore<T extends Record<string, unknown>>(row: T): T {
  if (row && (row as Record<string, unknown>)[PL_SDK_PENDING_WRITE_KEY] === true) {
    const { [PL_SDK_PENDING_WRITE_KEY]: _p, ...rest } = row as Record<string, unknown>;
    return rest as T;
  }
  return { ...row, [LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY]: true } as T;
}

export function isLocalMirrorMarkedServerBacked(doc: Record<string, unknown> | undefined | null): boolean {
  return doc?.[LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY] === true;
}

/** React state / forms — internal mirror meta + offline debug keys user payload me mat dikhao. */
export function stripLocalMirrorMetaForUiRow<T extends Record<string, unknown>>(row: T): T {
  if (!row || typeof row !== "object") return row;
  if (!(LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY in row) && !(PL_CLIENT_OFFLINE_FIRST_PERSIST_MS in row)) return row;
  const x = row as T & Record<string, unknown>;
  const { [LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY]: _m, [PL_CLIENT_OFFLINE_FIRST_PERSIST_MS]: _p, ...rest } = x;
  return rest as T;
}
