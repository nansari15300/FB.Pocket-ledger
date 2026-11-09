import { addDoc } from "@/lib/writeGateway/pbWrites";
import { collection, serverTimestamp } from "@/lib/pbCompat/firestore";
import type { Company } from "@/hooks/useCompany";
import { firestore } from "@/lib/plClientSession";
import { apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";

function createLocalEntityId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export async function createOneMasterEntityGroup(params: {
  company: Company | null | undefined;
  companyId: string;
  userId: string;
  name: string;
  parentId: string;
  collection: string;
  localIdPrefix: string;
  /** Optional other name (OCR / search). Omitted when empty. */
  aliasName?: string;
}): Promise<string> {
  const { company, companyId, userId, name, parentId, collection: coll, localIdPrefix } = params;
  const alias = String(params.aliasName ?? "").trim();
  const aliasField = alias ? { aliasName: alias } : {};
  if (apkEntityWriteUsesLocalSqliteMirror(company)) {
    const createdId = createLocalEntityId(localIdPrefix);
    const payload = {
      id: createdId,
      name: name.trim(),
      ownerId: userId,
      companyId,
      parentId,
      createdAt: new Date().toISOString(),
      isDeleted: false,
      ...aliasField,
    };
    await upsertCompanyDocInBrowserDb(companyId, coll, createdId, payload);
    await enqueueCompanyDocOutbox(companyId, coll, "create", createdId, payload);
    return createdId;
  }
  const docRef = await addDoc(collection(firestore, `companies/${companyId}/${coll}`), {
    name: name.trim(),
    ownerId: userId,
    companyId,
    parentId,
    createdAt: serverTimestamp(),
    isDeleted: false,
    ...aliasField,
  });
  return docRef.id;
}
