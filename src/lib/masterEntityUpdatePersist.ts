import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { Timestamp, doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";

/** Firebase write sentinels (`serverTimestamp()`) — SQLite JSON me serialize nahi hote. */
function isFirestoreWriteSentinel(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (value instanceof Date || value instanceof Timestamp) return false;
  if (typeof (value as { toDate?: unknown }).toDate === "function") return false;
  const rec = value as { _methodName?: unknown };
  return typeof rec._methodName === "string";
}

function patchForSqlite(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (isFirestoreWriteSentinel(value)) {
      if (key === "updatedAt" || key === "createdAt") {
        out[key] = Timestamp.now();
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Master edit save: Firestore pehle; quota / network fail par SQLite + outbox
 * taaki Alias Name / form fields locally persist hon.
 */
export async function persistMasterEntityUpdate(params: {
  companyId: string;
  collection: string;
  docId: string;
  patch: Record<string, unknown>;
}): Promise<void> {
  const { companyId, collection, docId, patch } = params;
  try {
    await updateDoc(doc(firestore, `companies/${companyId}/${collection}`, docId), patch);
  } catch (firestoreErr) {
    const fromDb = (await getCompanyDocFromBrowserDb(companyId, collection, docId)) ?? {};
    const payload: Record<string, unknown> = {
      ...fromDb,
      ...patchForSqlite(patch),
      id: docId,
      companyId,
    };
    try {
      await upsertCompanyDocInBrowserDb(companyId, collection, docId, payload);
      const persisted = (await getCompanyDocFromBrowserDb(companyId, collection, docId)) ?? payload;
      await enqueueCompanyDocOutbox(companyId, collection, "update", docId, persisted);
    } catch {
      throw firestoreErr;
    }
  }
}
