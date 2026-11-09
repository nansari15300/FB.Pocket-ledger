import { addDoc } from "@/lib/writeGateway/pbWrites";
import { collection, serverTimestamp, Timestamp } from "@/lib/pbCompat/firestore";
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

export async function createOnePartyGroup(params: {
  company: Company | null | undefined;
  companyId: string;
  userId: string;
  name: string;
  parentId: string;
  /** Optional other name (OCR / search). Omitted when empty. */
  aliasName?: string;
}): Promise<string> {
  const { company, companyId, userId, name, parentId } = params;
  const alias = String(params.aliasName ?? "").trim();
  const aliasField = alias ? { aliasName: alias } : {};
  if (apkEntityWriteUsesLocalSqliteMirror(company)) {
    const createdId = createLocalEntityId("group");
    const payload = {
      id: createdId,
      name: name.trim(),
      ownerId: userId,
      companyId,
      parentId,
      ...aliasField,
      createdAt: Timestamp.now(),
      isDeleted: false,
    };
    await upsertCompanyDocInBrowserDb(companyId, "groups", createdId, payload);
    await enqueueCompanyDocOutbox(companyId, "groups", "create", createdId, payload);
    return createdId;
  }
  const docRef = await addDoc(collection(firestore, `companies/${companyId}/groups`), {
    name: name.trim(),
    ownerId: userId,
    companyId,
    parentId,
    ...aliasField,
    createdAt: serverTimestamp(),
    isDeleted: false,
  });
  return docRef.id;
}
