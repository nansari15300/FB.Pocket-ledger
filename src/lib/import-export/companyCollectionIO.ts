"use client";

import { collection, query } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { writeEntity } from "@/lib/writeGateway";

export type ImportExportDoc = { id: string; data: Record<string, unknown> };

/** SQLite-first read; Firestore fallback when local mirror is empty (cloud-only web). */
export async function listImportExportCollectionDocs(
  companyId: string,
  collectionName: string
): Promise<ImportExportDoc[]> {
  if (!companyId || !collectionName) return [];
  const localRows = await listCompanyDocsFromBrowserDb(companyId, collectionName, { forBackupMerge: true });
  if (localRows.length > 0) {
    return localRows.map((row) => {
      const r = row as Record<string, unknown> & { id?: string };
      const id = String(r.id ?? "").trim();
      return { id, data: r };
    });
  }
  try {
    const snap = await getDocs(query(collection(firestore, `companies/${companyId}/${collectionName}`)));
    return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  } catch {
    return [];
  }
}

export async function listImportExportDocsByNameKey(
  companyId: string,
  collectionName: string,
  nameKey: string
): Promise<Array<{ id: string; name: string }>> {
  const docs = await listImportExportCollectionDocs(companyId, collectionName);
  return docs.map(({ id, data }) => ({
    id,
    name: String(data[nameKey] ?? data.name ?? id).trim().toLowerCase(),
  }));
}

export async function getOrCreateImportExportGroup(
  companyId: string,
  groupCollection: string,
  groupName: string,
  companyFields: { companyId: string }
): Promise<string> {
  const normalized = groupName.trim().toLowerCase();
  const existing = await listImportExportCollectionDocs(companyId, groupCollection);
  const found = existing.find(
    (d) => String(d.data.name ?? "").trim().toLowerCase() === normalized
  );
  if (found) return found.id;

  const res = await writeEntity({
    companyId,
    collectionName: groupCollection,
    docId: "",
    operation: "create",
    data: {
      name: groupName.trim(),
      companyId: companyFields.companyId,
      debit: 0,
      credit: 0,
      balance: 0,
    },
    options: { useFirestoreAutoId: true, skipPlanMutationGate: true },
  });
  if (!res.ok) throw new Error("error" in res ? res.error : "Group create failed");
  return res.docId;
}

export async function upsertImportExportDoc(
  companyId: string,
  collectionName: string,
  existingId: string | null,
  data: Record<string, unknown>
): Promise<string> {
  if (existingId) {
    const { balance: _b, debit: _d, credit: _c, ...updateData } = data;
    const res = await writeEntity({
      companyId,
      collectionName,
      docId: existingId,
      operation: "update",
      data: { ...updateData, updatedAt: new Date() },
      options: { merge: true, skipPlanMutationGate: true },
    });
    if (!res.ok) throw new Error("error" in res ? res.error : "Update failed");
    return existingId;
  }

  const res = await writeEntity({
    companyId,
    collectionName,
    docId: "",
    operation: "create",
    data: { ...data, createdAt: new Date() },
    options: { useFirestoreAutoId: true, skipPlanMutationGate: true },
  });
  if (!res.ok) throw new Error("error" in res ? res.error : "Create failed");
  return res.docId;
}
