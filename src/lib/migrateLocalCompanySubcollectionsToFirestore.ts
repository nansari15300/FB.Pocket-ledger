"use client";

/**
 * "Upload company to cloud" ke baad: sirf company root Firestore pe tha, vouchers/parties SQLite me —
 * yahan browser SQLite (`company_docs`) se saari subcollections Firestore me push (batched set).
 */

import { doc, writeBatch, Timestamp, type Firestore, type DocumentReference, type DocumentData } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } from "@/lib/firestoreToLocalCompanyPull";
import { isLocalFileRef } from "@/lib/localPendingFiles";
import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { yieldToMain } from "@/lib/yieldToMain";

const BATCH_MAX = 450;

function sanitizeValue(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "bigint") return (v as bigint).toString();
  if (v instanceof Date) return Timestamp.fromDate(v);
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) {
    const arr = v.map(sanitizeValue).filter((x) => x !== undefined);
    return arr;
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof (o as { toDate?: () => Date }).toDate === "function") {
      try {
        const d = (o as { toDate: () => Date }).toDate();
        if (d && !isNaN(d.getTime())) return Timestamp.fromDate(d);
      } catch {
        /* ignore */
      }
    }
    return sanitizeDocForFirestore(o);
  }
  if (typeof File !== "undefined" && v instanceof File) return undefined;
  if (typeof Blob !== "undefined" && v instanceof Blob) return undefined;
  return v;
}

function isHttpsAttachmentRef(u: string): boolean {
  return /^https?:\/\//i.test(String(u || "").trim());
}

/**
 * `local_only` — data-only restore: HTTPS bakho, `local:` hatao.
 * `all` — with-files restore: HTTPS + `local:` dono hatao (files phase baad me HTTPS patch).
 */
function stripAttachmentRefsFromDoc(
  obj: Record<string, unknown>,
  mode: "local_only" | "all"
): Record<string, unknown> {
  const out = { ...obj };
  const dropRef = (v: string) => {
    if (isLocalFileRef(v)) return true;
    if (mode === "all" && isHttpsAttachmentRef(v)) return true;
    return false;
  };
  for (const key of ["fileUrls", "documentFileUrls"] as const) {
    if (!Array.isArray(out[key])) continue;
    const filtered = (out[key] as unknown[])
      .map((v) => String(v ?? "").trim())
      .filter((v) => v && !dropRef(v));
    if (filtered.length === 0) delete out[key];
    else out[key] = filtered;
  }
  for (const key of ["fileUrl", "avatarUrl", "logoUrl"] as const) {
    const s = String(out[key] ?? "").trim();
    if (s && dropRef(s)) delete out[key];
  }
  const unassigned = out.unassignedFile;
  if (unassigned && typeof unassigned === "object") {
    const url = String((unassigned as Record<string, unknown>).url ?? "").trim();
    if (url && dropRef(url)) delete out.unassignedFile;
  }
  return out;
}

function stripLocalFileRefsFromDoc(obj: Record<string, unknown>): Record<string, unknown> {
  return stripAttachmentRefsFromDoc(obj, "local_only");
}

function sanitizeDocForFirestore(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const s = sanitizeValue(v);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

async function commitWrites(
  db: Firestore,
  ops: Array<{ ref: DocumentReference<DocumentData>; data: Record<string, unknown> }>
): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_MAX) {
    const chunk = ops.slice(i, i + BATCH_MAX);
    const batch = writeBatch(db);
    for (const { ref, data } of chunk) {
      batch.set(ref, data, { merge: true });
    }
    await batch.commit();
  }
}

/**
 * Local browser DB se saari mirror subcollections Firestore `companies/{fsCompanyId}/…` pe likho.
 * Company root doc pehle se hona chahiye (permissions).
 */
export async function pushAllLocalCompanyDocsToFirestore(
  fsCompanyId: string,
  options?: {
    sqliteCompanyId?: string;
    omitLocalFileRefs?: boolean;
    /** With-files restore: strip HTTPS + local: from cloud docs (SQLite still has local:). */
    omitAllAttachmentUrls?: boolean;
    onCollectionProgress?: (collectionName: string, index: number, total: number) => void;
  }
): Promise<{
  pushed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let pushed = 0;
  const sqliteCompanyId = String(options?.sqliteCompanyId || fsCompanyId).trim() || fsCompanyId;
  /**
   * A PocketBase company's rows already live on the server (`pl_data`). Pushing the SQLite mirror to
   * Firestore would create a second, drifting copy of the whole ledger in a project that no longer
   * serves data — and the next pull would then have to fight it. Upload to cloud for those companies
   * goes through `forceUploadLocalCompanyToServer`, not this Firestore path.
   */
  if (isPocketBaseCompanyId(fsCompanyId) || isPocketBaseCompanyId(sqliteCompanyId)) {
    return { pushed: 0, errors: [] };
  }
  const cols = COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS;
  const totalCols = cols.length;
  const stripMode: false | "local_only" | "all" = options?.omitAllAttachmentUrls
    ? "all"
    : options?.omitLocalFileRefs
      ? "local_only"
      : false;

  for (let colIndex = 0; colIndex < cols.length; colIndex++) {
    const collectionName = cols[colIndex]!;
    options?.onCollectionProgress?.(collectionName, colIndex, totalCols);
    try {
      await yieldToMain();
      let rows = await listCompanyDocsFromBrowserDb(sqliteCompanyId, collectionName, { forBackupMerge: true });
      if (!rows.length && sqliteCompanyId !== fsCompanyId) {
        rows = await listCompanyDocsFromBrowserDb(fsCompanyId, collectionName, { forBackupMerge: true });
      }
      if (!rows.length) continue;

      const ops: Array<{ ref: DocumentReference<DocumentData>; data: Record<string, unknown> }> = [];
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex]!;
        const docId = String((row as { id?: string }).id ?? "");
        if (!docId) continue;
        const { id: _omit, ...rest } = row as Record<string, unknown> & { id: string };
        const base = stripMode ? stripAttachmentRefsFromDoc(rest, stripMode) : rest;
        const data = sanitizeDocForFirestore(base as Record<string, unknown>);
        if (data.companyId == null || String(data.companyId).trim() === "") {
          data.companyId = fsCompanyId;
        }
        const ref: DocumentReference<DocumentData> = doc(firestore, `companies/${fsCompanyId}/${collectionName}`, docId);
        ops.push({ ref, data });
        if (rowIndex > 0 && rowIndex % 40 === 0) await yieldToMain();
      }

      if (ops.length) {
        await commitWrites(firestore, ops);
        pushed += ops.length;
        await yieldToMain();
      }
    } catch (e) {
      errors.push(`${collectionName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { pushed, errors };
}
