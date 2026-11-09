"use client";

import { auth } from "@/lib/plClientSession";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import {
  getCompanyDocFromBrowserDb,
  listCompanyDocsFromBrowserDb,
} from "@/lib/localCompanyDocMirror";
import { writeEntity } from "@/lib/writeGateway";
import { beginApkLedgerAsyncWriteShield } from "@/lib/apkLedgerRouteShield";
import { OPENING_BALANCE_SYSTEM_LEDGER_ID } from "@/lib/reports/openingBalanceLedgerAccounts";
import {
  collectMasterOpeningBalanceEntities,
  diagnoseSystemOpeningBalance,
  OPENING_BALANCE_MASTER_COLLECTIONS,
  systemOpeningBalanceLedgerFields,
  type MasterOpeningBalanceEntity,
  type OpeningBalanceMasterCollection,
  type SystemOpeningBalanceDiagnosis,
} from "@/lib/reports/systemOpeningBalanceEquity";

export type {
  MasterOpeningBalanceEntity,
  SystemOpeningBalanceDiagnosis,
} from "@/lib/reports/systemOpeningBalanceEquity";

export {
  collectMasterOpeningBalanceEntities,
  computeExpectedSystemOpeningBalance,
  diagnoseSystemOpeningBalance,
  diagnoseSystemOpeningBalanceFromProcessed,
} from "@/lib/reports/systemOpeningBalanceEquity";

const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();

function isAliveMasterRow(row: Record<string, unknown>): boolean {
  return row.isDeleted !== true;
}

async function loadMasterOpeningBalanceEntitiesFromDb(
  companyId: string
): Promise<MasterOpeningBalanceEntity[]> {
  const [parties, accounts, staff, taxes, expenseAccounts] = await Promise.all(
    OPENING_BALANCE_MASTER_COLLECTIONS.map((collection) =>
      listCompanyDocsFromBrowserDb(companyId, collection)
    )
  );

  return collectMasterOpeningBalanceEntities({
    processedParties: parties.filter(isAliveMasterRow) as MasterOpeningBalanceEntity[],
    processedAccounts: accounts.filter(isAliveMasterRow) as MasterOpeningBalanceEntity[],
    processedStaff: staff.filter(isAliveMasterRow) as MasterOpeningBalanceEntity[],
    processedTaxes: taxes.filter(isAliveMasterRow) as MasterOpeningBalanceEntity[],
    processedExpenseAccounts: expenseAccounts.filter(isAliveMasterRow) as MasterOpeningBalanceEntity[],
  }) as MasterOpeningBalanceEntity[];
}

async function readStoredSystemOpeningBalance(companyId: string): Promise<number> {
  const row = await getCompanyDocFromBrowserDb(
    companyId,
    "parties",
    OPENING_BALANCE_SYSTEM_LEDGER_ID,
    { includeDeleted: true }
  );
  return Number(row?.openingBalance) || 0;
}

async function ensureSystemOpeningBalanceLedgerDoc(companyId: string): Promise<void> {
  const existing = await getCompanyDocFromBrowserDb(
    companyId,
    "parties",
    OPENING_BALANCE_SYSTEM_LEDGER_ID,
    { includeDeleted: true }
  );
  if (existing) return;

  const reg = await getLocalCompanyById(companyId);
  let ownerId = String((reg as Record<string, unknown>)?.ownerId ?? "").trim();
  if (!ownerId) {
    ownerId = auth.currentUser?.uid || "local_guest_user";
  }

  const createRes = await writeEntity({
    companyId,
    collectionName: "parties",
    docId: OPENING_BALANCE_SYSTEM_LEDGER_ID,
    operation: "create",
    data: {
      name: "Opening Balance",
      groupId: "equity",
      openingBalance: 0,
      openingBalanceDate: null,
      companyId,
      ownerId,
      isDeleted: false,
      isSystemReserved: true,
      isSystemAccount: true,
      createdAt: Date.now(),
      balance: 0,
      debit: 0,
      credit: 0,
    },
  });
  if (createRes.ok === false) {
    throw new Error(createRes.error || "Failed to create system opening balance ledger");
  }
}

async function writeSystemOpeningBalanceLedger(
  companyId: string,
  expectedOpeningBalance: number
): Promise<void> {
  await ensureSystemOpeningBalanceLedgerDoc(companyId);
  const fields = systemOpeningBalanceLedgerFields(expectedOpeningBalance);

  const updRes = await writeEntity({
    companyId,
    collectionName: "parties",
    docId: OPENING_BALANCE_SYSTEM_LEDGER_ID,
    operation: "update",
    data: fields,
  });
  if (updRes.ok === false) {
    throw new Error(updRes.error || "Failed to update system opening balance ledger");
  }
}

export async function diagnoseSystemOpeningBalanceForCompany(
  companyId: string
): Promise<SystemOpeningBalanceDiagnosis> {
  const masterEntities = await loadMasterOpeningBalanceEntitiesFromDb(companyId);
  const storedSystemOpeningBalance = await readStoredSystemOpeningBalance(companyId);
  return diagnoseSystemOpeningBalance({ masterEntities, storedSystemOpeningBalance });
}

export type ReconcileSystemOpeningBalanceResult = {
  success: boolean;
  diagnosis: SystemOpeningBalanceDiagnosis;
  applied: boolean;
  error?: string;
};

/**
 * Reconcile `opening_balance_ledger` to the deterministic expected value from current masters.
 * When `apply` is false (default), returns diagnosis only — no data writes.
 */
export async function reconcileSystemOpeningBalanceLedger(
  companyId: string,
  options?: { apply?: boolean }
): Promise<ReconcileSystemOpeningBalanceResult> {
  const apply = options?.apply === true;
  try {
    if (!companyId) throw new Error("Company ID is missing");
    beginApkLedgerAsyncWriteShield({ pinCompanyId: companyId });

    const diagnosis = await diagnoseSystemOpeningBalanceForCompany(companyId);
    if (!apply || diagnosis.isReconciled) {
      return { success: true, diagnosis, applied: false };
    }

    await writeSystemOpeningBalanceLedger(companyId, diagnosis.expectedOpeningBalance);
    const after = await diagnoseSystemOpeningBalanceForCompany(companyId);
    return {
      success: after.isReconciled,
      diagnosis: after,
      applied: true,
      error: after.isReconciled ? undefined : "System opening balance still mismatched after repair",
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[systemOpeningBalanceEquity] reconcile failed", error);
    let diagnosis: SystemOpeningBalanceDiagnosis = {
      storedOpeningBalance: 0,
      expectedOpeningBalance: 0,
      difference: 0,
      isReconciled: true,
      masterTotalDebit: 0,
      masterTotalCredit: 0,
      masterNetSigned: 0,
    };
    try {
      diagnosis = await diagnoseSystemOpeningBalanceForCompany(companyId);
    } catch {
      /* keep fallback */
    }
    return { success: false, diagnosis, applied: false, error: msg };
  }
}

/** Debounced automatic reconcile after master opening-balance mutations. */
export function scheduleSystemOpeningBalanceReconcile(companyId: string): void {
  const cid = String(companyId || "").trim();
  if (!cid) return;

  const existing = reconcileTimers.get(cid);
  if (existing) clearTimeout(existing);

  reconcileTimers.set(
    cid,
    setTimeout(() => {
      reconcileTimers.delete(cid);
      void reconcileSystemOpeningBalanceLedger(cid, { apply: true }).then((result) => {
        if (!result.success) {
          console.warn("[systemOpeningBalanceEquity] scheduled reconcile failed", result.error);
        }
      });
    }, 75)
  );
}

export function isOpeningBalanceMasterCollection(
  collectionName: string
): collectionName is OpeningBalanceMasterCollection {
  return (OPENING_BALANCE_MASTER_COLLECTIONS as readonly string[]).includes(collectionName);
}
