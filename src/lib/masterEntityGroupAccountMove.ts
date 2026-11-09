import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import type { Company } from "@/hooks/useCompany";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import { apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import {
  normalizeBankGroupIdForStorage,
  normalizeExpenseGroupIdForStorage,
  normalizeItemGroupIdForStorage,
  normalizeStaffGroupIdForStorage,
  normalizeTaxGroupIdForStorage,
} from "@/lib/masterEntitySystemGroups";
import { normalizePartyGroupIdForStorage } from "@/lib/partySystemGroups";
import { LOAN_LIABILITY_GROUP_ID } from "@/modules/loans/constants/loanConstants";
import { isLoanLiabilityStaff } from "@/modules/loans/utils/loanLiabilityStaff";
import { STAFF_SYSTEM_GROUP_ID } from "@/lib/staffSystemGroups";
import { isInterCompanyPartyListAccount } from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import type { Party } from "@/components/party/types";

export type MasterEntityGroupMoveSpec<T extends { id: string; groupId?: string | null; name?: string }> =
  {
    collection: string;
    resolveTargetGroupId: (listGroupId: string) => string;
    resolveStoredGroupId: (account: T) => string;
    canMoveAccount: (account: T) => boolean;
    buildLocalMirrorPayload?: (
      account: T,
      companyId: string,
      groupId: string,
      fromDb: Record<string, unknown> | null
    ) => Record<string, unknown>;
  };

export function createMasterEntityGroupMoveHelpers<
  T extends { id: string; groupId?: string | null; name?: string },
>(spec: MasterEntityGroupMoveSpec<T>) {
  const resolveTarget = (listGroupId: string) => spec.resolveTargetGroupId(listGroupId);

  return {
    resolveTargetGroupId: resolveTarget,
    canMoveAccount: spec.canMoveAccount,
    alreadyInListGroup(account: T, listGroupId: string): boolean {
      return spec.resolveStoredGroupId(account) === resolveTarget(listGroupId);
    },
    async moveToGroup(args: {
      companyId: string;
      company: Company | null | undefined;
      account: T;
      targetListGroupId: string;
    }): Promise<void> {
      const { companyId, company, account, targetListGroupId } = args;
      if (spec.canMoveAccount(account) === false) return;
      if (spec.resolveStoredGroupId(account) === resolveTarget(targetListGroupId)) return;

      const groupId = resolveTarget(targetListGroupId);
      const localSqlMirror = apkEntityWriteUsesLocalSqliteMirror(company);

      if (localSqlMirror) {
        const fromDb = await getCompanyDocFromBrowserDb(companyId, spec.collection, account.id);
        const payload =
          spec.buildLocalMirrorPayload?.(account, companyId, groupId, fromDb) ??
          {
            ...(fromDb ?? { id: account.id, companyId, name: account.name }),
            id: account.id,
            companyId,
            groupId,
          };
        await upsertCompanyDocInBrowserDb(companyId, spec.collection, account.id, payload);
        await enqueueCompanyDocOutbox(companyId, spec.collection, "update", account.id, payload);
        return;
      }

      await updateDoc(doc(firestore, `companies/${companyId}/${spec.collection}`, account.id), {
        groupId,
      });
    },
  };
}

function isFrozenMaster(account: { isFrozen?: boolean }): boolean {
  return account.isFrozen === true;
}

function isSystemMaster(account: { isSystemAccount?: boolean; isSystemReserved?: boolean }): boolean {
  return account.isSystemAccount === true || account.isSystemReserved === true;
}

export const partyGroupAccountMove = createMasterEntityGroupMoveHelpers<Party>({
  collection: "parties",
  resolveTargetGroupId: (listGroupId) => normalizePartyGroupIdForStorage(listGroupId),
  resolveStoredGroupId: (party) => normalizePartyGroupIdForStorage(party.groupId),
  canMoveAccount: (party) => {
    if (isInterCompanyPartyListAccount(party)) return false;
    if (isSystemMaster(party as Party & { isSystemAccount?: boolean })) return false;
    if (isFrozenMaster(party)) return false;
    return true;
  },
});

export const bankGroupAccountMove = createMasterEntityGroupMoveHelpers<{
  id: string;
  groupId?: string | null;
  name?: string;
  accountType?: string | null;
  isFrozen?: boolean;
  isSystemReserved?: boolean;
  isSpecial?: boolean;
}>({
  collection: "bank_accounts",
  resolveTargetGroupId: (listGroupId) => normalizeBankGroupIdForStorage(listGroupId),
  resolveStoredGroupId: (account) =>
    normalizeBankGroupIdForStorage(account.groupId, account.accountType),
  canMoveAccount: (account) => {
    if (isSystemMaster(account)) return false;
    if (isFrozenMaster(account)) return false;
    return true;
  },
});

export const staffGroupAccountMove = createMasterEntityGroupMoveHelpers<{
  id: string;
  groupId?: string | null;
  name?: string;
  isLoanAccount?: boolean | null;
  isFrozen?: boolean;
  isSystemAccount?: boolean;
  isSystemReserved?: boolean;
}>({
  collection: "staff",
  resolveTargetGroupId: (listGroupId) => normalizeStaffGroupIdForStorage(listGroupId),
  resolveStoredGroupId: (account) =>
    normalizeStaffGroupIdForStorage(
      account.groupId,
      isLoanLiabilityStaff(account) ? LOAN_LIABILITY_GROUP_ID : STAFF_SYSTEM_GROUP_ID
    ),
  canMoveAccount: (account) => !isSystemMaster(account) && !isFrozenMaster(account),
});

export const taxGroupAccountMove = createMasterEntityGroupMoveHelpers<{
  id: string;
  groupId?: string | null;
  name?: string;
  isFrozen?: boolean;
  isSystemAccount?: boolean;
  isSystemReserved?: boolean;
}>({
  collection: "taxes",
  resolveTargetGroupId: (listGroupId) => normalizeTaxGroupIdForStorage(listGroupId),
  resolveStoredGroupId: (account) => normalizeTaxGroupIdForStorage(account.groupId),
  canMoveAccount: (account) => !isSystemMaster(account) && !isFrozenMaster(account),
});

export const itemGroupAccountMove = createMasterEntityGroupMoveHelpers<{
  id: string;
  groupId?: string | null;
  name?: string;
  type?: string | null;
  isFrozen?: boolean;
  isSystemAccount?: boolean;
  isSystemReserved?: boolean;
}>({
  collection: "items",
  resolveTargetGroupId: (listGroupId) => normalizeItemGroupIdForStorage(listGroupId),
  resolveStoredGroupId: (account) => normalizeItemGroupIdForStorage(account.groupId, account.type),
  canMoveAccount: (account) => !isSystemMaster(account) && !isFrozenMaster(account),
});

export const expenseGroupAccountMove = createMasterEntityGroupMoveHelpers<{
  id: string;
  groupId?: string | null;
  name?: string;
  type?: string | null;
  isFrozen?: boolean;
  isSystemAccount?: boolean;
  isSystemReserved?: boolean;
}>({
  collection: "expense_accounts",
  resolveTargetGroupId: (listGroupId) => normalizeExpenseGroupIdForStorage(listGroupId),
  resolveStoredGroupId: (account) =>
    normalizeExpenseGroupIdForStorage(account.groupId, account.type),
  canMoveAccount: (account) => !isSystemMaster(account) && !isFrozenMaster(account),
});
