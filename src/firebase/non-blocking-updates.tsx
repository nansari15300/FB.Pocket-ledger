'use client';

import type { CollectionReference, DocumentReference, SetOptions } from '@/lib/pbCompat/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { writeEntity, writeEntityNonBlocking } from '@/lib/writeGateway';

/** `companies/{companyId}/{collection}/{docId}` — gateway ke liye parse. */
function parseCompanySubdocPath(path: string): { companyId: string; collectionName: string; docId: string } | null {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m) return null;
  return { companyId: m[1], collectionName: m[2], docId: m[3] };
}

/** `companies/{companyId}/{collection}` — `addDoc` ke liye. */
function parseCompanyCollectionPath(path: string): { companyId: string; collectionName: string } | null {
  const m = /^companies\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m) return null;
  return { companyId: m[1], collectionName: m[2] };
}

function emitPermission(
  path: string,
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write',
  data?: unknown
) {
  errorEmitter.emit(
    'permission-error',
    new FirestorePermissionError({
      path,
      operation,
      requestResourceData: data,
    })
  );
}

/**
 * `setDoc` — `writeEntity` create + optional `merge` (Firestore `setDoc` jaisa; merge=false = full replace).
 * Await nahi — errors console + permission emitter.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: unknown, options: SetOptions) {
  const p = parseCompanySubdocPath(docRef.path);
  if (!p) {
    console.error('[setDocumentNonBlocking] unsupported path (use writeEntity directly):', docRef.path);
    return;
  }
  const merge = !!(options as { merge?: boolean })?.merge;
  void writeEntity({
    companyId: p.companyId,
    collectionName: p.collectionName,
    docId: p.docId,
    operation: 'create',
    data: data as Record<string, unknown>,
    options: merge ? { merge: true } : { merge: false },
  }).catch((error) => {
    emitPermission(docRef.path, 'write', data);
    console.warn('[setDocumentNonBlocking]', error);
  });
}

/**
 * `addDoc` — company subcollection par auto id; await nahi karta (Promise return compatibility).
 */
export function addDocumentNonBlocking(colRef: CollectionReference, data: unknown) {
  const p = parseCompanyCollectionPath(colRef.path);
  if (!p) {
    console.error('[addDocumentNonBlocking] unsupported path:', colRef.path);
    return Promise.resolve(undefined);
  }
  return writeEntity({
    companyId: p.companyId,
    collectionName: p.collectionName,
    docId: '',
    operation: 'create',
    data: data as Record<string, unknown>,
    options: { useFirestoreAutoId: true },
  })
    .then((r) => {
      if (!r.ok) {
        emitPermission(colRef.path, 'create', data);
        return undefined;
      }
      return { id: r.docId };
    })
    .catch((error) => {
      emitPermission(colRef.path, 'create', data);
      console.warn('[addDocumentNonBlocking]', error);
      return undefined;
    });
}

/**
 * `updateDoc` — partial patch gateway se.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: unknown) {
  const p = parseCompanySubdocPath(docRef.path);
  if (!p) {
    console.error('[updateDocumentNonBlocking] unsupported path:', docRef.path);
    return;
  }
  writeEntityNonBlocking({
    companyId: p.companyId,
    collectionName: p.collectionName,
    docId: p.docId,
    operation: 'update',
    data: data as Record<string, unknown>,
  });
}

/**
 * `deleteDoc` — company subdoc hard delete (gateway).
 */
export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  const p = parseCompanySubdocPath(docRef.path);
  if (!p) {
    console.error('[deleteDocumentNonBlocking] unsupported path:', docRef.path);
    return;
  }
  writeEntityNonBlocking({
    companyId: p.companyId,
    collectionName: p.collectionName,
    docId: p.docId,
    operation: 'delete',
  });
}
