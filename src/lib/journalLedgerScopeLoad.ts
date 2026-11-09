"use client";

/**
 * Compare-before-sync: journal edit ke liye jis company ka voucher hai usi ke party/staff/bank/expense/tax —
 * `useVouchers()` sirf app-header wali company deta hai.
 *
 * Local / PL server companies: SQLite pehle — Firestore permission-denied se masters khali mat karo.
 */
import { collection } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { companyRowUsesSqliteLedgerWrites, isServerGateCompany } from "@/lib/companyStorageKind";
import { isLocalOnlyMode } from "@/lib/localMode";
import { getActiveGate } from "@/lib/gates/gateStore";
import { shouldFetchPlServerAccessContext } from "@/lib/plServerAccessContext";

export type JournalScopedLedgerSnapshot = {
  processedPartiesForSelection: Array<{ id: string; name: string; balance: number }>;
  processedStaff: Array<{ id: string; name: string; balance: number }>;
  processedAccounts: Array<{ id: string; name?: string; accountName?: string; balance: number }>;
  expenseAccounts: Array<{ id: string; name: string; balance: number }>;
  processedTaxes: Array<{ id: string; name: string; balance: number }>;
};

const EMPTY_SNAPSHOT: JournalScopedLedgerSnapshot = {
  processedPartiesForSelection: [],
  processedStaff: [],
  processedAccounts: [],
  expenseAccounts: [],
  processedTaxes: [],
};

function mergeRowsById<T extends { id: string }>(server: T[], local: T[]): T[] {
  const m = new Map<string, T>();
  server.forEach((r) => m.set(r.id, r));
  local.forEach((r) => m.set(r.id, r));
  return Array.from(m.values());
}

function isAliveRow(data: Record<string, unknown>): boolean {
  return data.isDeleted !== true;
}

async function companyUsesSqliteMasters(companyId: string): Promise<boolean> {
  if (isLocalOnlyMode()) return true;
  if (typeof window !== "undefined") {
    if (getActiveGate().type === "local_server") return true;
    if (shouldFetchPlServerAccessContext()) return true;
  }
  try {
    const row = await getLocalCompanyById(companyId, { includeDeleted: true });
    if (!row) return false;
    if (String(row.storageOption || "").toLowerCase() === "local") return true;
    if (isServerGateCompany(row)) return true;
    if (companyRowUsesSqliteLedgerWrites(row)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function mapPartyRow(data: Record<string, unknown>, fallbackId?: string): { id: string; name: string; balance: number } | null {
  if (!isAliveRow(data)) return null;
  const id = String(data.id ?? fallbackId ?? "").trim();
  if (!id) return null;
  const name = String(data.name || id).trim() || id;
  return { id, name, balance: Number(data.balance) || 0 };
}

function mapStaffRow(data: Record<string, unknown>, fallbackId?: string): { id: string; name: string; balance: number } | null {
  if (!isAliveRow(data)) return null;
  const id = String(data.id ?? fallbackId ?? "").trim();
  if (!id) return null;
  const name = String(data.name || id).trim() || id;
  return { id, name, balance: Number(data.balance) || 0 };
}

function mapBankRow(
  data: Record<string, unknown>,
  fallbackId?: string
): { id: string; name?: string; accountName?: string; balance: number } | null {
  if (!isAliveRow(data)) return null;
  const id = String(data.id ?? fallbackId ?? "").trim();
  if (!id) return null;
  const accountName = String(data.accountName || data.name || id).trim() || id;
  return { id, accountName, name: accountName, balance: Number(data.balance) || 0 };
}

function mapNamedRow(
  data: Record<string, unknown>,
  fallbackId?: string
): { id: string; name: string; balance: number } | null {
  if (!isAliveRow(data)) return null;
  const id = String(data.id ?? fallbackId ?? "").trim();
  if (!id) return null;
  const name = String(data.name || id).trim() || id;
  return { id, name, balance: Number(data.balance) || 0 };
}

async function loadCollectionFromSqlite<T extends { id: string }>(
  companyId: string,
  collectionName: string,
  mapRow: (data: Record<string, unknown>, fallbackId?: string) => T | null
): Promise<T[]> {
  try {
    const localRows = await listCompanyDocsFromBrowserDb(companyId, collectionName, { forBackupMerge: true });
    return localRows
      .map((r) => mapRow(r as Record<string, unknown>, String((r as { id?: string }).id || "")))
      .filter((x): x is T => x != null);
  } catch {
    return [];
  }
}

async function loadCollectionFromFirestore<T extends { id: string }>(
  companyId: string,
  collectionName: string,
  mapRow: (data: Record<string, unknown>, fallbackId?: string) => T | null
): Promise<T[]> {
  try {
    const snap = await getDocs(collection(firestore, `companies/${companyId}/${collectionName}`));
    return snap.docs
      .map((d) => mapRow(d.data() as Record<string, unknown>, d.id))
      .filter((x): x is T => x != null);
  } catch {
    return [];
  }
}

async function loadJournalLedgerScopeFromSqlite(companyId: string): Promise<JournalScopedLedgerSnapshot> {
  const [processedPartiesForSelection, processedStaff, processedAccounts, expenseAccounts, processedTaxes] =
    await Promise.all([
      loadCollectionFromSqlite(companyId, "parties", mapPartyRow),
      loadCollectionFromSqlite(companyId, "staff", mapStaffRow),
      loadCollectionFromSqlite(companyId, "bank_accounts", mapBankRow),
      loadCollectionFromSqlite(companyId, "expense_accounts", mapNamedRow),
      loadCollectionFromSqlite(companyId, "taxes", mapNamedRow),
    ]);
  return {
    processedPartiesForSelection,
    processedStaff,
    processedAccounts,
    expenseAccounts,
    processedTaxes,
  };
}

async function loadJournalLedgerScopeFromFirestore(companyId: string): Promise<JournalScopedLedgerSnapshot> {
  const [parties, staff, banks, expenses, taxes] = await Promise.all([
    loadCollectionFromFirestore(companyId, "parties", mapPartyRow),
    loadCollectionFromFirestore(companyId, "staff", mapStaffRow),
    loadCollectionFromFirestore(companyId, "bank_accounts", mapBankRow),
    loadCollectionFromFirestore(companyId, "expense_accounts", mapNamedRow),
    loadCollectionFromFirestore(companyId, "taxes", mapNamedRow),
  ]);
  return {
    processedPartiesForSelection: parties,
    processedStaff: staff,
    processedAccounts: banks,
    expenseAccounts: expenses,
    processedTaxes: taxes,
  };
}

export async function loadJournalLedgerScopeSnapshot(companyId: string): Promise<JournalScopedLedgerSnapshot> {
  const cid = String(companyId || "").trim();
  if (!cid) return { ...EMPTY_SNAPSHOT };

  const sqliteFirst = await companyUsesSqliteMasters(cid);
  if (sqliteFirst) {
    const local = await loadJournalLedgerScopeFromSqlite(cid);
    if (
      local.processedPartiesForSelection.length ||
      local.processedStaff.length ||
      local.processedAccounts.length ||
      local.expenseAccounts.length ||
      local.processedTaxes.length
    ) {
      return local;
    }
    // SQLite empty (cold restore): optional Firestore merge for hybrid rows only.
    try {
      const remote = await loadJournalLedgerScopeFromFirestore(cid);
      return {
        processedPartiesForSelection: mergeRowsById(remote.processedPartiesForSelection, local.processedPartiesForSelection),
        processedStaff: mergeRowsById(remote.processedStaff, local.processedStaff),
        processedAccounts: mergeRowsById(remote.processedAccounts, local.processedAccounts),
        expenseAccounts: mergeRowsById(remote.expenseAccounts, local.expenseAccounts),
        processedTaxes: mergeRowsById(remote.processedTaxes, local.processedTaxes),
      };
    } catch {
      return local;
    }
  }

  try {
    const remote = await loadJournalLedgerScopeFromFirestore(cid);
    const local = await loadJournalLedgerScopeFromSqlite(cid);
    return {
      processedPartiesForSelection: mergeRowsById(remote.processedPartiesForSelection, local.processedPartiesForSelection),
      processedStaff: mergeRowsById(remote.processedStaff, local.processedStaff),
      processedAccounts: mergeRowsById(remote.processedAccounts, local.processedAccounts),
      expenseAccounts: mergeRowsById(remote.expenseAccounts, local.expenseAccounts),
      processedTaxes: mergeRowsById(remote.processedTaxes, local.processedTaxes),
    };
  } catch {
    return loadJournalLedgerScopeFromSqlite(cid);
  }
}
