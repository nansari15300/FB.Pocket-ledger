'use client';

/**
 * Pocket Ledger Server document store — the drop-in replacement for `firebase/firestore`.
 *
 * The app was written against the Firestore client SDK. Every read, write and live query now goes to
 * the Pocket Ledger Server (PocketBase) through this module:
 *
 *   references   doc() / collection() / collectionGroup()      -> plain path objects (pbRef/pbQuery)
 *   reads        getDoc / getDocs / getCountFromServer ...     -> pbReadSeam (SQLite mirror + server)
 *   writes       setDoc / updateDoc / addDoc / deleteDoc ...   -> writeGateway (pbWrites)
 *   live         onSnapshot                                    -> pbReadSeam re-reads on change bumps
 *   values       serverTimestamp / increment / arrayUnion ...  -> local markers (pbValues)
 *
 * `firebase/firestore` is no longer imported anywhere, so the SDK leaves the bundle.
 */

import { PbCollectionReference, PbDocumentReference, type Converter } from "@/lib/pocketbaseData/pbRef";
import { PbCollectionGroupQuery, PbQuery, pbCollection, pbDoc, type PbQuerySpec } from "@/lib/pocketbaseData/pbQuery";
import {
  deleteField,
  FieldPath,
  increment,
  arrayRemove,
  arrayUnion,
  serverTimestamp,
  Timestamp,
  type FieldValue,
} from "@/lib/pocketbaseData/pbValues";
import { __installFirestoreImpls } from "@/lib/writeGateway/pbRawFirestore";

type AnyFn = (...args: any[]) => any;

/**
 * Lazy requires: pbReadSeam / firestoreMutationsInternal import Timestamp / types /
 * firestoreHandle from this file. Static imports here would race at module init and
 * could leave bindings undefined. Call-time require runs after both modules finished.
 */
function seamMod(): typeof import("@/lib/pocketbaseData/pbReadSeam") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/lib/pocketbaseData/pbReadSeam");
}
function gwMod(): typeof import("@/lib/writeGateway/firestoreMutationsInternal") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/lib/writeGateway/firestoreMutationsInternal");
}

const writeSetDoc: AnyFn = (...args) => (gwMod().setDoc as AnyFn)(...args);
const writeAddDoc: AnyFn = (...args) => (gwMod().addDoc as AnyFn)(...args);
const writeDeleteDoc: AnyFn = (...args) => (gwMod().deleteDoc as AnyFn)(...args);
const writeRunTransaction: AnyFn = (...args) => (gwMod().runTransaction as AnyFn)(...args);
const writeUpdateDoc: AnyFn = (...args) => (gwMod().updateDoc as AnyFn)(...args);
const writeBatchImpl: AnyFn = (...args) => (gwMod().writeBatch as AnyFn)(...args);
const readSeamGetDoc: AnyFn = (...args) => (seamMod().getDoc as AnyFn)(...args);
const readSeamGetDocFromServer: AnyFn = (...args) => (seamMod().getDocFromServer as AnyFn)(...args);
const readSeamGetDocFromCache: AnyFn = (...args) => (seamMod().getDocFromCache as AnyFn)(...args);
const readSeamGetDocs: AnyFn = (...args) => (seamMod().getDocs as AnyFn)(...args);
const readSeamGetDocsFromServer: AnyFn = (...args) => (seamMod().getDocsFromServer as AnyFn)(...args);
const readSeamGetDocsFromCache: AnyFn = (...args) => (seamMod().getDocsFromCache as AnyFn)(...args);
const readSeamOnSnapshot: AnyFn = (...args) => (seamMod().onSnapshot as AnyFn)(...args);
const readSeamGetCountFromServer: AnyFn = (...args) => (seamMod().getCountFromServer as AnyFn)(...args);


/** `setDoc(ref, data, options?)` — routed to the server / device mirror by the write gateway. */
export function setDoc(ref: DocumentReference, data: DocumentData, options?: SetOptions): Promise<void> {
  return writeSetDoc(ref as unknown, data, options as unknown) as unknown as Promise<void>;
}

/** `updateDoc(ref, data)` / `updateDoc(ref, "field", value, ...)`. */
export function updateDoc(ref: DocumentReference, ...data: unknown[]): Promise<void> {
  return writeUpdateDoc(ref as unknown, ...data) as unknown as Promise<void>;
}

/** `deleteDoc(ref)` — soft-deletes a company doc on the server. */
export function deleteDoc(ref: DocumentReference): Promise<void> {
  return writeDeleteDoc(ref as unknown) as unknown as Promise<void>;
}

/** `addDoc(collectionRef, data)` — server-assigned id. */
export function addDoc<T = DocumentData>(collectionRef: CollectionReference, data: DocumentData): Promise<DocumentReference<T>> {
  return writeAddDoc(collectionRef as unknown, data) as unknown as Promise<DocumentReference<T>>;
}

/** `writeBatch(db)` — one atomic commit on the server. */
export function writeBatch(_db?: unknown): WriteBatch {
  return writeBatchImpl(_db as never) as unknown as WriteBatch;
}

/** `runTransaction(db, fn)` — one retried transaction on the server. */
export function runTransaction<T>(_db: unknown, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return writeRunTransaction(_db as never, fn as never) as unknown as Promise<T>;
}

/* ------------------------------------------------------------------ */
/* types the app annotates with                                        */
/* ------------------------------------------------------------------ */

export type DocumentData = Record<string, unknown>;
export type FirestoreErrorCode = string;
export type Unsubscribe = () => void;
export type SetOptions = { merge?: boolean; mergeFields?: unknown };
export type SnapshotOptions = { serverTimestamps?: "estimate" | "previous" | "none" };
export type QueryDocumentSnapshot<T = DocumentData> = {
  id: string;
  ref: DocumentReference<T>;
  exists: true;
  data(options?: SnapshotOptions): T;
  get(field: string): unknown;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
};
export type QuerySnapshot<T = DocumentData> = {
  docs: QueryDocumentSnapshot<T>[];
  size: number;
  empty: boolean;
  forEach(cb: (d: QueryDocumentSnapshot<T>) => void, thisArg?: unknown): void;
  docChanges(): unknown[];
  query: Query<T>;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
};
export type DocumentSnapshot<T = DocumentData> = {
  id: string;
  ref: DocumentReference<T>;
  exists: () => boolean;
  data(): T | undefined;
  get(field: string): unknown;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
};

export type DocumentReference<T = DocumentData> = PbDocumentReference & { __doc?: T };
export type CollectionReference<T = DocumentData> = PbCollectionReference & { __coll?: T };
export type Query<T = DocumentData> = PbQuery & { __q?: T };
export type QueryConstraint = unknown;export type Transaction = {
  get(ref: DocumentReference | Query): Promise<DocumentSnapshot>;
  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): Transaction;
  update(ref: DocumentReference, data: DocumentData): Transaction;
  delete(ref: DocumentReference): Transaction;
};
export type WriteBatch = {
  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): WriteBatch;
  update(ref: DocumentReference, data: DocumentData): WriteBatch;
  delete(ref: DocumentReference): WriteBatch;
  commit(): Promise<void>;
};

export type Firestore = { __plServerStore: true };

/** Firestore-shaped error for callbacks that inspect `.code`. */
export class FirestoreError extends Error {
  readonly code: FirestoreErrorCode;
  constructor(code: FirestoreErrorCode, message?: string) {
    super(message ?? code);
    this.name = "FirebaseError";
    this.code = code;
  }
}

/** Typed reads/writes — same signatures, the values come from the Pocket Ledger Server. */
export function readDoc<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  return readSeamGetDoc(ref as unknown) as unknown as Promise<DocumentSnapshot<T>>;
}
export function readQuery<T = DocumentData>(q: Query<T> | CollectionReference<T>): Promise<QuerySnapshot<T>> {
  return readSeamGetDocs(q as unknown) as unknown as Promise<QuerySnapshot<T>>;
}

/* ------------------------------------------------------------------ */
/* references                                                          */
/* ------------------------------------------------------------------ */

/** The handle the app passes as the first argument; it carries no path of its own. */
export const firestoreHandle: Firestore = Object.freeze({ __plServerStore: true as const });

export function doc<T = DocumentData>(db: unknown, ...parts: unknown[]): DocumentReference<T>;
export function doc<T = DocumentData>(collectionRef: CollectionReference, id?: string): DocumentReference<T>;
export function doc<T = DocumentData>(path: string, ...rest: unknown[]): DocumentReference<T>;
export function doc(a: unknown, ...rest: unknown[]): DocumentReference {
  if (typeof a === "string" && rest.length === 0) {
    const segments = a.split("/").filter(Boolean);
    return new PbDocumentReference(segments);
  }
  return pbDoc(a, ...rest) as DocumentReference;
}

export function collection<T = DocumentData>(db: unknown, ...parts: unknown[]): CollectionReference<T> {
  return pbCollection(db, ...parts) as unknown as CollectionReference<T>;
}

export function collectionGroup<T = DocumentData>(db: unknown, id: string): Query<T> {
  void db;
  return new PbCollectionGroupQuery(String(id)) as unknown as Query<T>;
}

export function query<T = DocumentData>(base: CollectionReference<T> | Query<T>, ...constraints: unknown[]): Query<T> {
  let q = (base as unknown as PbQuery).__plQuery
    ? (base as unknown as PbQuery)
    : PbQuery.fromCollection(base as PbCollectionReference);
  for (const c of constraints) {
    const k = c as Record<string, unknown> | null;
    if (!k || typeof k !== "object") continue;
    if (k.__where) {
      const w = k.__where as { fieldPath: unknown; op: string; value: unknown };
      q = q.where(w.fieldPath, w.op, w.value);
    } else if (k.__orderBy) {
      const o = k.__orderBy as { fieldPath: unknown; direction: "asc" | "desc" };
      q = q.orderBy(o.fieldPath, o.direction);
    } else if (k.__limit !== undefined) {
      q = q.limit(Number(k.__limit));
    } else if (k.__limitToLast !== undefined) {
      q = q.limitToLast(Number(k.__limitToLast));
    } else if (k.__startAt) {
      q = q.startAt(...(k.__startAt as unknown[]));
    } else if (k.__startAfter) {
      q = q.startAfter(...(k.__startAfter as unknown[]));
    } else if (k.__endAt) {
      q = q.endAt(...(k.__endAt as unknown[]));
    } else if (k.__endBefore) {
      q = q.endBefore(...(k.__endBefore as unknown[]));
    }
  }
  return q as unknown as Query<T>;
}

/** `query(ref).where(...)` / `collection(db, ...).where(...)` chains keep their data type. */
export function where<T = DocumentData>(q: Query<T>, field: unknown, op: string, value: unknown): Query<T>;
export function where(fieldPath: unknown, op: string, value: unknown): unknown;
export function where(a: unknown, b: unknown, c?: unknown, d?: unknown): unknown {
  if (arguments.length === 4) {
    return (a as PbQuery).where(b, String(c), d) as unknown;
  }
  return { __where: { fieldPath: a, op: b, value: c } };
}

export function orderBy<T = DocumentData>(q: Query<T>, field: unknown, dir?: "asc" | "desc"): Query<T>;
export function orderBy(fieldPath: unknown, direction?: "asc" | "desc"): unknown;
export function orderBy(a: unknown, b?: unknown, c?: unknown): unknown {
  if (arguments.length >= 2 && a && typeof a === "object" && (a as { __plQuery?: unknown }).__plQuery) {
    return (a as PbQuery).orderBy(b, (c as "asc" | "desc") || "asc") as unknown;
  }
  return { __orderBy: { fieldPath: a, direction: (b as "asc" | "desc") || "asc" } };
}

export function limit<T = DocumentData>(q: Query<T>, n: number): Query<T>;
export function limit(n: number): unknown;
export function limit(a: unknown, b?: unknown): unknown {
  if (typeof b === "number" && a && typeof a === "object" && (a as { __plQuery?: unknown }).__plQuery) {
    return (a as PbQuery).limit(b) as unknown;
  }
  return { __limit: Number(a) };
}

export function limitToLast(n: number): unknown {
  return { __limitToLast: n };
}
export function startAt(...values: unknown[]): unknown {
  return { __startAt: values };
}

export function startAfter<T = DocumentData>(q: Query<T>, ...values: unknown[]): Query<T>;
export function startAfter(...values: unknown[]): unknown;
export function startAfter(a: unknown, ...rest: unknown[]): unknown {
  if (a && typeof a === "object" && (a as { __plQuery?: unknown }).__plQuery) {
    return (a as PbQuery).startAfter(...rest) as unknown;
  }
  return { __startAfter: [a, ...rest] };
}

export function endAt(...values: unknown[]): unknown {
  return { __endAt: values };
}
export function endBefore(...values: unknown[]): unknown {
  return { __endBefore: values };
}

/* ------------------------------------------------------------------ */
/* network / cache — no-ops (the store is the server + device mirror)   */
/* ------------------------------------------------------------------ */

export type MemoryLocalCache = { __cache: "memory" };
export type PersistentLocalCache = { __cache: "persistent"; tabManager?: unknown };

export function memoryLocalCache(): MemoryLocalCache {
  return { __cache: "memory" };
}

export function persistentLocalCache(opts?: { tabManager?: unknown }): PersistentLocalCache {
  return { __cache: "persistent", tabManager: opts?.tabManager };
}

export function persistentSingleTabManager(_opts?: unknown): unknown {
  return { __tabManager: "single" };
}

export function persistentMultipleTabManager(): unknown {
  return { __tabManager: "multiple" };
}

/** There is no Firestore network to switch: these kept the old SDK quiet, now they are no-ops. */
export async function enableNetwork(_db?: unknown): Promise<void> {
  /* no Firestore network */
}

export async function disableNetwork(_db?: unknown): Promise<void> {
  /* no Firestore network */
}

export function terminate(_db?: unknown): Promise<void> {
  return Promise.resolve();
}

export function clearIndexedDbPersistence(_db?: unknown): Promise<void> {
  return Promise.resolve();
}

export function setLogLevel(_level: string): void {
  /* no SDK to configure */
}

/* ------------------------------------------------------------------ */
/* re-exports                                                          */
/* ------------------------------------------------------------------ */

export {
  arrayRemove,
  arrayUnion,
  deleteField,
  FieldPath,
  increment,
  serverTimestamp,
  Timestamp,
};

/** `getCountFromServer(query)` — server COUNT, no documents transferred. */
export function getCountFromServer<T = DocumentData>(q: Query<T> | CollectionReference<T>): Promise<{ data: () => { count: number } }> {
  return readSeamGetCountFromServer(q as unknown) as unknown as Promise<{ data: () => { count: number } }>;
}

/** `onSnapshot(ref | query, observer | onNext, onError?, onComplete?)` — re-reads on mirror bumps. */
export function onSnapshot<T = DocumentData>(
  target: DocumentReference<T> | Query<T> | CollectionReference<T>,
  ...rest: unknown[]
): Unsubscribe {
  return readSeamOnSnapshot(target as unknown, ...rest) as unknown as Unsubscribe;
}

/**
 * Leaf stubs for `pbRawFirestore` slots. Firebase client SDK is gone; pbReadSeam /
 * firestoreMutationsInternal fall back to raw* only for non-PB paths. Installing the
 * exported wrappers here used to recurse (rawOnSnapshot -> onSnapshot -> rawOnSnapshot).
 */
const leafWriteGone = async (..._args: unknown[]): Promise<never> => {
  throw new Error("[pl] Firebase write leaf removed");
};
const leafReadGone = async (..._args: unknown[]): Promise<never> => {
  throw new Error("[pl] Firebase read leaf removed");
};
__installFirestoreImpls({
  setDoc: leafWriteGone,
  updateDoc: leafWriteGone,
  deleteDoc: leafWriteGone,
  addDoc: leafWriteGone,
  writeBatch: (..._args: unknown[]) => {
    throw new Error("[pl] Firebase write leaf removed");
  },
  runTransaction: leafWriteGone,
  getDoc: leafReadGone,
  getDocFromServer: leafReadGone,
  getDocFromCache: leafReadGone,
  getDocs: leafReadGone,
  getDocsFromServer: leafReadGone,
  getDocsFromCache: leafReadGone,
  onSnapshot: (..._args: unknown[]) => () => {},
  getCountFromServer: leafReadGone,
});

/** `documentId()` — same as `FieldPath.documentId()`. */
export function documentId(): unknown {
  return FieldPath.documentId();
}

/* ------------------------------------------------------------------ */
/* reads — typed like the SDK so call sites keep their annotations     */
/* ------------------------------------------------------------------ */

/** `getDoc(ref)` — reads the document from the device mirror / the server. */
export function getDoc<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  return readSeamGetDoc(ref as unknown) as unknown as Promise<DocumentSnapshot<T>>;
}

/** `getDocFromServer(ref)` — always the server copy. */
export function getDocFromServer<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  return readSeamGetDocFromServer(ref as unknown) as unknown as Promise<DocumentSnapshot<T>>;
}

/** `getDocFromCache(ref)` — the device copy only. */
export function getDocFromCache<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  return readSeamGetDocFromCache(ref as unknown) as unknown as Promise<DocumentSnapshot<T>>;
}

/** `getDocs(query)` — reads the list from the device mirror / the server. */
export function getDocs<T = DocumentData>(q: Query<T> | CollectionReference<T>): Promise<QuerySnapshot<T>> {
  return readSeamGetDocs(q as unknown) as unknown as Promise<QuerySnapshot<T>>;
}

/** `getDocsFromServer(query)` — always the server copy. */
export function getDocsFromServer<T = DocumentData>(q: Query<T> | CollectionReference<T>): Promise<QuerySnapshot<T>> {
  return readSeamGetDocsFromServer(q as unknown) as unknown as Promise<QuerySnapshot<T>>;
}

/** `getDocsFromCache(query)` — the device copy only. */
export function getDocsFromCache<T = DocumentData>(q: Query<T> | CollectionReference<T>): Promise<QuerySnapshot<T>> {
  return readSeamGetDocsFromCache(q as unknown) as unknown as Promise<QuerySnapshot<T>>;
}

export type { Converter, FieldValue, PbQuerySpec };

/** Kept for code that stored the type; the store is the Pocket Ledger Server. */
export type FirestoreLike = Firestore;

/** `getFirestore()` — the app's store handle (no Firestore instance exists any more). */
export function getFirestore(_app?: unknown): Firestore {
  return firestoreHandle;
}

/** `initializeFirestore(app, settings)` — same handle; the settings (cache, long-polling) are moot. */
export function initializeFirestore(_app?: unknown, _settings?: unknown): Firestore {
  return firestoreHandle;
}
