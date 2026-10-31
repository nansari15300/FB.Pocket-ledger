import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import {
  normalizeExpenseGroupIdForStorage,
  resolveExpenseListGroupBucketId,
} from "@/lib/masterEntitySystemGroups";
import type { ExpenseAccount } from "@/components/expenses/types";
import type { Company } from "@/hooks/useCompany";
import { apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";

export function resolveExpenseAccountMoveTargetGroupId(listGroupId: string): string {
  return resolveExpenseListGroupBucketId({ groupId: listGroupId });
}

export function expenseAccountAlreadyInListGroup(
  account: Pick<ExpenseAccount, "groupId" | "type">,
  listGroupId: string
): boolean {
  const target = resolveExpenseAccountMoveTargetGroupId(listGroupId);
  const current = normalizeExpenseGroupIdForStorage(account.groupId, account.type);
  return current === target;
}

export function canMoveExpenseAccountInGroupList(account: ExpenseAccount): boolean {
  if ((account as { isSystemReserved?: boolean }).isSystemReserved) return false;
  if (account.id === "sales_account" || account.id === "purchase_account") return false;
  if (account.isFrozen) return false;
  return true;
}

export async function moveExpenseAccountToGroup(args: {
  companyId: string;
  company: Company | null | undefined;
  account: ExpenseAccount;
  targetListGroupId: string;
}): Promise<void> {
  const { companyId, company, account, targetListGroupId } = args;
  if (expenseAccountAlreadyInListGroup(account, targetListGroupId)) return;

  const groupId = normalizeExpenseGroupIdForStorage(
    resolveExpenseAccountMoveTargetGroupId(targetListGroupId),
    account.type
  );
  const localSqlMirror = apkEntityWriteUsesLocalSqliteMirror(company);

  if (localSqlMirror) {
    const fromDb = await getCompanyDocFromBrowserDb(companyId, "expense_accounts", account.id);
    const base: Record<string, unknown> = fromDb ?? {
      id: account.id,
      companyId,
      name: account.name,
      balance: account.balance,
      debit: account.debit,
      credit: account.credit,
      isDeleted: false,
      type: account.type,
    };
    const payload: Record<string, unknown> = { ...base, id: account.id, companyId, groupId };
    await upsertCompanyDocInBrowserDb(companyId, "expense_accounts", account.id, payload);
    await enqueueCompanyDocOutbox(companyId, "expense_accounts", "update", account.id, payload);
    return;
  }

  await updateDoc(doc(firestore, `companies/${companyId}/expense_accounts`, account.id), {
    groupId,
  });
}
