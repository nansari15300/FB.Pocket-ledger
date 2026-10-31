import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import type { Party } from "@/components/party/types";
import {
  patchMasterAnusuchi13ConfirmationFields,
  type Anusuchi13ConfirmationFyRecord,
} from "@/lib/reports/anusuchi13Confirmation";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import {
  getCompanyDocFromBrowserDb,
  upsertCompanyDocInBrowserDb,
} from "@/lib/localCompanyDocMirror";
import { apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import type { Company } from "@/hooks/useCompany";

export type Anusuchi13MasterCollection = "parties" | "staff" | "taxes";

type ConfirmableMaster = {
  id: string;
  companyId: string;
  name?: string;
  openingBalance?: number;
  balance?: number;
  debit?: number;
  credit?: number;
  anusuchi13ConfirmationByFy?: Record<string, Anusuchi13ConfirmationFyRecord>;
};

export async function patchMasterAnusuchi13Confirmation<T extends ConfirmableMaster>(
  company: Company | null | undefined,
  collection: Anusuchi13MasterCollection,
  entity: T,
  fyKey: string,
  patch: Partial<Anusuchi13ConfirmationFyRecord>
): Promise<T> {
  const companyId = entity.companyId || company?.id;
  if (!companyId) throw new Error("Company required");

  const fields = patchMasterAnusuchi13ConfirmationFields(entity, fyKey, patch);
  const nextEntity = { ...entity, ...fields };

  if (apkEntityWriteUsesLocalSqliteMirror(company)) {
    const fromDb = await getCompanyDocFromBrowserDb(companyId, collection, entity.id);
    const base: Record<string, unknown> = fromDb ?? {
      id: entity.id,
      companyId,
      name: entity.name ?? "",
      openingBalance: entity.openingBalance ?? 0,
      balance: entity.balance ?? 0,
      debit: entity.debit ?? 0,
      credit: entity.credit ?? 0,
      isDeleted: false,
    };
    const payload: Record<string, unknown> = {
      ...base,
      ...fields,
      id: entity.id,
      companyId,
      updatedAt: new Date().toISOString(),
    };
    await upsertCompanyDocInBrowserDb(companyId, collection, entity.id, payload);
    await enqueueCompanyDocOutbox(companyId, collection, "update", entity.id, payload);
    return nextEntity;
  }

  await updateDoc(doc(firestore, `companies/${companyId}/${collection}`, entity.id), {
    ...fields,
    updatedAt: serverTimestamp(),
  });
  return nextEntity;
}

/** @deprecated use patchMasterAnusuchi13Confirmation */
export async function patchPartyAnusuchi13Confirmation(
  company: Company | null | undefined,
  party: Party,
  fyKey: string,
  patch: Partial<Anusuchi13ConfirmationFyRecord>
): Promise<Party> {
  return patchMasterAnusuchi13Confirmation(company, "parties", party, fyKey, patch);
}
