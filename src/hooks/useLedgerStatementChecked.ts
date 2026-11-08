"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import {
  BROWSER_DB_COLLECTION_BUMP,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";
import {
  LEDGER_STATEMENT_CHECKS_COLLECTION,
  persistLedgerStatementCheckedData,
  readLedgerStatementCheckDataFromDb,
  type StatementCheckMeta,
} from "@/lib/ledgerStatementCheckPersist";
import {
  statementCheckTxnId,
  type StatementCheckLedgerScope,
} from "@/lib/statementCheckModeStorage";

type Args = {
  companyId: string | undefined;
  context: string;
  contextId: string | undefined;
  enabled?: boolean;
};

function sameCheckedIdSet(prev: Set<string>, ids: readonly string[]): boolean {
  if (prev.size !== ids.length) return false;
  for (const id of ids) {
    if (!prev.has(id)) return false;
  }
  return true;
}

/** 3-dot → Mark as Reconciled Point — SQLite + online sync; stores author, timestamp & message. */
export function useLedgerStatementChecked({
  companyId,
  context,
  contextId,
  enabled = true,
}: Args) {
  const { user } = useAuth();
  const { company } = useCompany();
  const userId = user?.uid ?? "anon";

  const scope: StatementCheckLedgerScope | null = useMemo(() => {
    if (!enabled || !companyId || !contextId) return null;
    return { userId, companyId, context, contextId };
  }, [enabled, userId, companyId, context, contextId]);

  const scopeKey = scope
    ? `${scope.userId}:${scope.companyId}:${scope.context}:${scope.contextId}`
    : null;

  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [metaById, setMetaById] = useState<Record<string, StatementCheckMeta>>({});
  const hydratedScopeRef = useRef<string | null>(null);
  const marksHydratedRef = useRef(false);
  const userTouchedRef = useRef(false);

  useEffect(() => {
    if (!scope || !scopeKey) {
      setCheckedIds(new Set());
      setMetaById({});
      hydratedScopeRef.current = null;
      marksHydratedRef.current = false;
      userTouchedRef.current = false;
      return;
    }
    if (hydratedScopeRef.current === scopeKey) return;
    hydratedScopeRef.current = scopeKey;
    marksHydratedRef.current = false;
    userTouchedRef.current = false;
    setCheckedIds(new Set());
    setMetaById({});

    let cancelled = false;
    void readLedgerStatementCheckDataFromDb(scope.companyId, scope).then((data) => {
      if (cancelled || hydratedScopeRef.current !== scopeKey || userTouchedRef.current) return;
      setCheckedIds(new Set(data.markedIds));
      setMetaById(data.metaById || {});
      marksHydratedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [scope, scopeKey]);

  useEffect(() => {
    if (!scope || !companyId) return;
    const onBump = (e: Event) => {
      const detail = (e as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (!detail || detail.companyId !== companyId) return;
      if (detail.collection !== LEDGER_STATEMENT_CHECKS_COLLECTION) return;
      // Prevent local write echo loop
      if (detail.source === "local_write") return;
      void readLedgerStatementCheckDataFromDb(companyId, scope).then((data) => {
        if (hydratedScopeRef.current !== scopeKey) return;
        setCheckedIds((prev) => (sameCheckedIdSet(prev, data.markedIds) ? prev : new Set(data.markedIds)));
        setMetaById(data.metaById || {});
        marksHydratedRef.current = true;
      });
    };
    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    return () => window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
  }, [scope, companyId, scopeKey]);

  const isChecked = useCallback(
    (tx: { id?: string; _rowKey?: string }) => {
      const id = statementCheckTxnId(tx);
      return Boolean(id && checkedIds.has(id));
    },
    [checkedIds]
  );

  const toggleChecked = useCallback(
    (tx: { id?: string; _rowKey?: string }) => {
      if (!scope) return;
      const id = statementCheckTxnId(tx);
      if (!id) return;
      userTouchedRef.current = true;
      marksHydratedRef.current = true;
      const nextChecked = new Set(checkedIds);
      const nextMeta = { ...metaById };

      if (nextChecked.has(id)) {
        nextChecked.delete(id);
        delete nextMeta[id];
      } else {
        nextChecked.add(id);
        nextMeta[id] = {
          markedBy: user?.displayName || user?.email || "User",
          markedAt: new Date().toISOString(),
          message: "",
        };
      }
      setCheckedIds(nextChecked);
      setMetaById(nextMeta);
      void persistLedgerStatementCheckedData(company, scope, [...nextChecked], nextMeta);
    },
    [scope, company, checkedIds, metaById, user]
  );

  const updateNote = useCallback(
    async (id: string, message: string) => {
      if (!scope || !id) return;
      const currentMeta = metaById[id] || {
        markedBy: user?.displayName || user?.email || "User",
        markedAt: new Date().toISOString(),
      };
      const nextMeta: Record<string, StatementCheckMeta> = {
        ...metaById,
        [id]: {
          ...currentMeta,
          message: message.trim(),
        },
      };
      setMetaById(nextMeta);
      await persistLedgerStatementCheckedData(company, scope, [...checkedIds], nextMeta);
    },
    [scope, company, checkedIds, metaById, user]
  );

  const canMark = Boolean(scope);

  return {
    checkedIds,
    metaById,
    canMark,
    isChecked,
    toggleChecked,
    updateNote,
  };
}
