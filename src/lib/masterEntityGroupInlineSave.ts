import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";

export type MasterEntityGroupCollection = "bank_accounts" | "staff" | "expense_accounts";

export async function saveMasterEntityGroupId(params: {
  companyId: string;
  collection: MasterEntityGroupCollection;
  entityId: string;
  groupId: string | null | undefined;
  localSqlMirror: boolean;
}): Promise<void> {
  const { companyId, collection, entityId, groupId, localSqlMirror } = params;
  const docId = String(entityId || "").trim();
  if (!String(companyId || "").trim() || !docId) {
    throw new Error("Cannot update group: missing company or account.");
  }
  const normalizedGroupId = groupId?.trim() ? groupId.trim() : null;

  if (localSqlMirror) {
    const fromDb = await getCompanyDocFromBrowserDb(companyId, collection, docId);
    if (!fromDb) {
      throw new Error("Could not load account for group update.");
    }
    const payload = { ...fromDb, groupId: normalizedGroupId };
    await upsertCompanyDocInBrowserDb(companyId, collection, docId, payload);
    await enqueueCompanyDocOutbox(companyId, collection, "update", docId, payload);
    return;
  }

  await updateDoc(doc(firestore, `companies/${companyId}/${collection}`, docId), {
    groupId: normalizedGroupId,
    updatedAt: serverTimestamp(),
  });
}
