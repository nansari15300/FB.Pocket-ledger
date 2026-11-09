import { addDoc } from "@/lib/writeGateway/pbWrites";
import { collection, serverTimestamp } from "@/lib/pbCompat/firestore";
import type { Company } from "@/hooks/useCompany";
import { firestore } from "@/lib/plClientSession";
import {
  apkEntityWriteUsesLocalSqliteMirror,
} from "@/lib/apkOnlineFirestoreWritePolicy";
import { upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";

function createLocalEntityId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export async function createOneExpenseGroup(params: {
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
    const createdId = createLocalEntityId("expense_group");
    const payload = {
      id: createdId,
      name: name.trim(),
      ownerId: userId,
      companyId,
      parentId,
      ...aliasField,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    };
    await upsertCompanyDocInBrowserDb(companyId, "expense_groups", createdId, payload);
    await enqueueCompanyDocOutbox(companyId, "expense_groups", "create", createdId, payload);
    return createdId;
  }
  const docRef = await addDoc(collection(firestore, `companies/${companyId}/expense_groups`), {
    name: name.trim(),
    ownerId: userId,
    companyId,
    parentId,
    ...aliasField,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}
