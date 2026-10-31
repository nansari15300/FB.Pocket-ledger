/**
 * `DocumentReference` / `CollectionReference` se company-scoped paths parse karke `writeEntity` call —
 * UI components me seedha `updateDoc(ref)` ki jagah yahi use karo.
 */
import type { CollectionReference, DocumentReference } from "@/lib/pbCompat/firestore";
import { writeEntity, type WriteEntityResult } from "@/lib/writeGateway/writeEntity";

function parseCompanySubdoc(path: string): { companyId: string; collectionName: string; docId: string } | null {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m) return null;
  return { companyId: m[1], collectionName: m[2], docId: m[3] };
}

function parseCompanyCollection(path: string): { companyId: string; collectionName: string } | null {
  const m = /^companies\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m) return null;
  return { companyId: m[1], collectionName: m[2] };
}

/** Company subcollection doc par partial update — gateway-only path. */
export async function writeEntityUpdateCompanyDocRef(
  ref: DocumentReference,
  data: Record<string, unknown>
): Promise<WriteEntityResult> {
  const p = parseCompanySubdoc(ref.path);
  if (!p) return { ok: false, error: `writeEntityUpdateCompanyDocRef: unsupported path ${ref.path}` };
  return writeEntity({ ...p, operation: "update", data });
}

/** Company subdoc create / replace — `merge` true ho to set-merge semantics. */
export async function writeEntitySetCompanyDocRef(
  ref: DocumentReference,
  data: Record<string, unknown>,
  options?: { merge?: boolean }
): Promise<WriteEntityResult> {
  const p = parseCompanySubdoc(ref.path);
  if (!p) return { ok: false, error: `writeEntitySetCompanyDocRef: unsupported path ${ref.path}` };
  return writeEntity({
    ...p,
    operation: "create",
    data,
    options: { merge: options?.merge === true },
  });
}

/** Company subdoc delete. */
export async function writeEntityDeleteCompanyDocRef(ref: DocumentReference): Promise<WriteEntityResult> {
  const p = parseCompanySubdoc(ref.path);
  if (!p) return { ok: false, error: `writeEntityDeleteCompanyDocRef: unsupported path ${ref.path}` };
  return writeEntity({ ...p, operation: "delete" });
}

/** Company subcollection me naya doc — Firestore auto id. */
export async function writeEntityAddCompanyCollectionRef(
  colRef: CollectionReference,
  data: Record<string, unknown>
): Promise<WriteEntityResult> {
  const p = parseCompanyCollection(colRef.path);
  if (!p) return { ok: false, error: `writeEntityAddCompanyCollectionRef: unsupported path ${colRef.path}` };
  return writeEntity({
    companyId: p.companyId,
    collectionName: p.collectionName,
    docId: "",
    operation: "create",
    data,
    options: { useFirestoreAutoId: true },
  });
}
