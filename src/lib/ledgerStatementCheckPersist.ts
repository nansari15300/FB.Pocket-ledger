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
