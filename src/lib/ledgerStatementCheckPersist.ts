import type { Company } from "@/hooks/useCompany";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import {
  getCompanyDocFromBrowserDb,
  notifyBrowserDbCollectionUpdated,
  upsertCompanyDocInBrowserDb,
} from "@/lib/localCompanyDocMirror";
import type { StatementCheckLedgerScope } from "@/lib/statementCheckModeStorage";
import { writeEntity } from "@/lib/writeGateway/writeEntity";

export const LEDGER_STATEMENT_CHECKS_COLLECTION = "ledger_statement_checks";

export type StatementCheckMeta = {
  markedBy?: string;
  markedAt?: string;
  message?: string;
};

/** One entry in the "backdated voucher" conflict history */
export type ConflictHistoryEntry = {
  /** ISO timestamp when user clicked "Continue" */
  at: string;
  /** Who performed the action */
  byUser: string;
  /** The Reconciled Point date (formatted string) */
  reconciledDate: string;
  /** The balance at the Reconciled Point BEFORE this action (optional, may be null) */
  balanceBefore?: number | null;
  /** Net balance change caused by this backdated voucher (amount / effect) */
  balanceDelta?: number | null;
  /** Balance AFTER the backdated action */
  balanceAfter?: number | null;
  /** The voucher date that was backdated */
  voucherDate: string;
  /** Voucher number, if known */
  voucherNo?: string | null;
  /** Account / ledger name */
  accountName?: string | null;
  /** "new" | "edit" | "delete" */
  action?: string;
};

export type LedgerStatementCheckData = {
  markedIds: string[];
  metaById: Record<string, StatementCheckMeta>;
};

export function ledgerStatementCheckDocId(scope: StatementCheckLedgerScope): string {
  return `${scope.userId}__${scope.context}__${scope.contextId}`;
}

function parseMarkedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function parseMetaById(raw: unknown): Record<string, StatementCheckMeta> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, StatementCheckMeta> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === "object") {
      const item = v as Record<string, unknown>;
      out[k] = {
        markedBy: typeof item.markedBy === "string" ? item.markedBy : undefined,
        markedAt: typeof item.markedAt === "string" ? item.markedAt : undefined,
        message: typeof item.message === "string" ? item.message : undefined,
      };
    }
  }
  return out;
}

async function mirrorLedgerStatementCheckRow(
  companyId: string,
  docId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await upsertCompanyDocInBrowserDb(companyId, LEDGER_STATEMENT_CHECKS_COLLECTION, docId, payload, {
    notify: false,
  });
}

async function readLedgerStatementCheckFromFirestore(
  companyId: string,
  scope: StatementCheckLedgerScope
): Promise<LedgerStatementCheckData> {
  try {
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    const fsCompanyId = String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || companyId).trim();
    const docId = ledgerStatementCheckDocId(scope);
    const snap = await getDoc(doc(firestore, `companies/${fsCompanyId}/${LEDGER_STATEMENT_CHECKS_COLLECTION}/${docId}`));
    if (!snap.exists()) return { markedIds: [], metaById: {} };
    const data = snap.data() as Record<string, unknown>;
    const markedIds = parseMarkedIds(data.markedIds);
    const metaById = parseMetaById(data.metaById);
    const payload: Record<string, unknown> = {
      ...data,
      id: docId,
      companyId,
      userId: scope.userId,
      context: scope.context,
      contextId: scope.contextId,
      markedIds,
      metaById,
    };
    await mirrorLedgerStatementCheckRow(companyId, docId, payload);
    return { markedIds, metaById };
  } catch {
    return { markedIds: [], metaById: {} };
  }
}

export async function readLedgerStatementCheckDataFromDb(
  companyId: string,
  scope: StatementCheckLedgerScope
): Promise<LedgerStatementCheckData> {
  const docId = ledgerStatementCheckDocId(scope);
  const row = await getCompanyDocFromBrowserDb(companyId, LEDGER_STATEMENT_CHECKS_COLLECTION, docId);
  const fromSqlite = parseMarkedIds(row?.markedIds);
  const metaFromSqlite = parseMetaById(row?.metaById);
  if (fromSqlite.length > 0) return { markedIds: fromSqlite, metaById: metaFromSqlite };
  return readLedgerStatementCheckFromFirestore(companyId, scope);
}

export async function readLedgerStatementCheckedIdsFromDb(
  companyId: string,
  scope: StatementCheckLedgerScope
): Promise<string[]> {
  const data = await readLedgerStatementCheckDataFromDb(companyId, scope);
  return data.markedIds;
}

export async function persistLedgerStatementCheckedData(
  company: Company | null | undefined,
  scope: StatementCheckLedgerScope,
  markedIds: string[],
  metaById: Record<string, StatementCheckMeta>
): Promise<void> {
  const companyId = scope.companyId;
  const docId = ledgerStatementCheckDocId(scope);
  const existing = await getCompanyDocFromBrowserDb(companyId, LEDGER_STATEMENT_CHECKS_COLLECTION, docId);
  const payload: Record<string, unknown> = {
    ...(existing ?? {}),
    id: docId,
    companyId,
    userId: scope.userId,
    context: scope.context,
    contextId: scope.contextId,
    markedIds,
    metaById,
    updatedAt: new Date().toISOString(),
  };

  const result = await writeEntity({
    companyId,
    collectionName: LEDGER_STATEMENT_CHECKS_COLLECTION,
    docId,
    operation: existing ? "update" : "create",
    data: payload,
    options: existing ? undefined : { merge: true },
  });

  if (!result.ok) {
    console.warn(
      "[ledgerStatementCheckPersist] save failed",
      (result as { ok: false; error: string }).error
    );
    return;
  }

  notifyBrowserDbCollectionUpdated(companyId, LEDGER_STATEMENT_CHECKS_COLLECTION, {
    immediate: true,
    source: "local_write",
  });
}

export async function persistLedgerStatementCheckedIds(
  company: Company | null | undefined,
  scope: StatementCheckLedgerScope,
  markedIds: string[]
): Promise<void> {
  const existing = await readLedgerStatementCheckDataFromDb(scope.companyId, scope);
  await persistLedgerStatementCheckedData(company, scope, markedIds, existing.metaById);
}

/** Max history entries stored per entity */
export const MAX_CONFLICT_HISTORY = 5;

/**
 * Append a new backdated-voucher conflict history entry to the entity's
 * ledger_statement_checks document.  Keeps only the latest MAX_CONFLICT_HISTORY entries.
 */
export async function persistConflictHistoryEntry(
  companyId: string,
  contextId: string,
  entry: ConflictHistoryEntry
): Promise<void> {
  // We store history in a special doc keyed by contextId (not per-user)
  const docId = `conflict_history__${contextId}`;
  let existing: Record<string, unknown> | null = null;
  try {
    existing = await getCompanyDocFromBrowserDb(companyId, LEDGER_STATEMENT_CHECKS_COLLECTION, docId);
  } catch {
    existing = null;
  }

  const prevHistory: ConflictHistoryEntry[] = Array.isArray((existing as any)?.conflictHistory)
    ? (existing as any).conflictHistory
    : [];

  // Prepend newest entry, keep up to MAX_CONFLICT_HISTORY
  const nextHistory = [entry, ...prevHistory].slice(0, MAX_CONFLICT_HISTORY);

  const payload: Record<string, unknown> = {
    ...(existing ?? {}),
    id: docId,
    companyId,
    contextId,
    conflictHistory: nextHistory,
    updatedAt: new Date().toISOString(),
  };

  await writeEntity({
    companyId,
    collectionName: LEDGER_STATEMENT_CHECKS_COLLECTION,
    docId,
    operation: existing ? "update" : "create",
    data: payload,
    options: existing ? undefined : { merge: true },
  });

  notifyBrowserDbCollectionUpdated(companyId, LEDGER_STATEMENT_CHECKS_COLLECTION, {
    immediate: true,
    source: "local_write",
  });
}

/**
 * Read the conflict history for a given contextId (account / party / staff).
 */
export async function readConflictHistory(
  companyId: string,
  contextId: string
): Promise<ConflictHistoryEntry[]> {
  const docId = `conflict_history__${contextId}`;
  try {
    const doc = await getCompanyDocFromBrowserDb(companyId, LEDGER_STATEMENT_CHECKS_COLLECTION, docId);
    if (!doc) return [];
    return Array.isArray((doc as any).conflictHistory)
      ? (doc as any).conflictHistory
      : [];
  } catch {
    return [];
  }
}
