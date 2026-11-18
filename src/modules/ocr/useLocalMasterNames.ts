"use client";

import { useEffect, useState } from "react";
import {
  BROWSER_DB_COLLECTION_BUMP,
  listCompanyDocsFromBrowserDb,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";

/** Master collections whose names appear in the Accounts column (From / To / via). */
const NAME_COLLECTIONS: ReadonlyArray<{ coll: string; fields: readonly string[] }> = [
  { coll: "parties", fields: ["name", "partyName"] },
  { coll: "bank_accounts", fields: ["accountName", "name"] },
  { coll: "staff", fields: ["name"] },
  { coll: "taxes", fields: ["name"] },
  { coll: "expense_accounts", fields: ["name", "accountName"] },
  { coll: "items", fields: ["name"] },
];

/**
 * id -> display name for masters, read from the local voucher store.
 * The /gallery route loads only `vouchers` into the voucher provider (ledgerActiveMasterCollections),
 * so `journalAccountNames` there has no party / bank names and the Recent OCR Trxn Accounts
 * column showed "From: -". This fills the names without loading masters for the whole page.
 */
export function useLocalMasterNames(companyId: string): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const watched = new Set(NAME_COLLECTIONS.map((c) => c.coll));
    let timer: number | null = null;
    const onBump = (event: Event) => {
      const detail = (event as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (!detail || !watched.has(detail.collection)) return;
      if (detail.companyId && companyId && detail.companyId !== companyId) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setBump((n) => n + 1), 600);
    };
    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    return () => {
      window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [companyId]);

  useEffect(() => {
    const cid = String(companyId || "").trim();
    if (!cid) {
      setNames({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const { coll, fields } of NAME_COLLECTIONS) {
        let rows: any[] = [];
        try {
          rows = await listCompanyDocsFromBrowserDb(cid, coll);
        } catch {
          rows = [];
        }
        for (const row of rows) {
          const id = String(row?.id || "").trim();
          if (!id || row?.isDeleted === true) continue;
          for (const f of fields) {
            const v = typeof row?.[f] === "string" ? row[f].trim() : "";
            if (v) {
              next[id] = v;
              break;
            }
          }
        }
        if (cancelled) return;
      }
      if (!cancelled) setNames(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, bump]);

  return names;
}
