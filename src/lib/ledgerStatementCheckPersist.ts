import type { Company } from "@/hooks/useCompany";
import { doc } from "firebase/firestore";
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

export function ledgerStatementCheckDocId(scope: StatementCheckLedgerScope): string {
  return `${scope.userId}__${scope.context}__${scope.contextId}`;
}

function parseMarkedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
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
): Promise<string[]> {
  try {
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    const fsCompanyId = String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || companyId).trim();
    const docId = ledgerStatementCheckDocId(scope);
    const snap = await getDoc(doc(firestore, `companies/${fsCompanyId}/${LEDGER_STATEMENT_CHECKS_COLLECTION}/${docId}`));
    if (!snap.exists()) return [];
    const data = snap.data() as Record<string, unknown>;
    const markedIds = parseMarkedIds(data.markedIds);
    const payload: Record<string, unknown> = {
      ...data,
      id: docId,
      companyId,
      userId: scope.userId,
      context: scope.context,
      contextId: scope.contextId,
      markedIds,
    };
    await mirrorLedgerStatementCheckRow(companyId, docId, payload);
    return markedIds;
  } catch {
    return [];
  }
}

export async function readLedgerStatementCheckedIdsFromDb(
  companyId: string,
  scope: StatementCheckLedgerScope
): Promise<string[]> {
  const docId = ledgerStatementCheckDocId(scope);
  const row = await getCompanyDocFromBrowserDb(companyId, LEDGER_STATEMENT_CHECKS_COLLECTION, docId);
  const fromSqlite = parseMarkedIds(row?.markedIds);
  if (fromSqlite.length > 0) return fromSqlite;
  return readLedgerStatementCheckFromFirestore(companyId, scope);
}

export async function persistLedgerStatementCheckedIds(
  company: Company | null | undefined,
  scope: StatementCheckLedgerScope,
  markedIds: string[]
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
