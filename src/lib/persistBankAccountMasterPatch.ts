"use client";

import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import type { Company } from "@/hooks/useCompany";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox, flushVoucherOutbox } from "@/lib/localVoucherOutbox";
import { apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { normalizeSpecialAccountUseFor, type SpecialAccountUseFor } from "@/lib/specialAccountUsage";

export type BankAccountMasterPatch = {
  isSpecial?: boolean;
  useFor?: SpecialAccountUseFor;
};

/** Bank/cash master — isSpecial / useFor (Manage Sharing + edit dialog parity). */
export async function persistBankAccountMasterPatch(
  companyId: string,
  company: Company | null | undefined,
  accountId: string,
  patch: BankAccountMasterPatch
): Promise<void> {
  const cid = String(companyId || "").trim();
  const aid = String(accountId || "").trim();
  if (!cid || !aid) return;

  const updateFields: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.isSpecial !== undefined) updateFields.isSpecial = patch.isSpecial === true;
  if (patch.useFor !== undefined) {
    updateFields.useFor = normalizeSpecialAccountUseFor(patch.useFor);
  }

  const localSqlMirror = apkEntityWriteUsesLocalSqliteMirror(company);

  if (localSqlMirror) {
    let fromDb = await getCompanyDocFromBrowserDb(cid, "bank_accounts", aid);
    if (!fromDb) {
      try {
        const snap = await getDoc(doc(firestore, `companies/${cid}/bank_accounts`, aid));
        if (snap.exists()) {
          fromDb = { id: aid, companyId: cid, ...(snap.data() as Record<string, unknown>) };
        }
      } catch {
        /* offline — fall through */
      }
    }
    const base: Record<string, unknown> = fromDb ?? {
      id: aid,
      companyId: cid,
      isDeleted: false,
    };
    const payload: Record<string, unknown> = { ...base, ...updateFields, id: aid, companyId: cid };
    await upsertCompanyDocInBrowserDb(cid, "bank_accounts", aid, payload);
    const persisted = (await getCompanyDocFromBrowserDb(cid, "bank_accounts", aid)) ?? payload;
    await enqueueCompanyDocOutbox(cid, "bank_accounts", "update", aid, persisted);
    if (typeof navigator !== "undefined" && navigator.onLine) {
      void flushVoucherOutbox({
        priority: { companyId: cid, collectionName: "bank_accounts", docId: aid },
      }).catch(() => undefined);
    }
    return;
  }

  const accountRef = doc(firestore, `companies/${cid}/bank_accounts`, aid);
  await updateDoc(accountRef, updateFields);
}
