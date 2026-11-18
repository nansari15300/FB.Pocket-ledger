"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import {
  BROWSER_DB_COLLECTION_BUMP,
  getCompanyDocFromBrowserDb,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";

export type VoucherDocById = Record<string, unknown> & { id: string };

/**
 * Vouchers by id, read straight from the local voucher store (PocketBase as fallback), for ids
 * that are missing from the FY-scoped `useVouchers()` list - e.g. a runner voucher whose bill date
 * is in an older year. Gallery OCR History / Recent OCR Trxn use it so such vouchers still show.
 */
export function useVouchersByIds(
  companyId: string,
  ids: readonly string[],
  fsCompanyId?: string
): Map<string, VoucherDocById> {
  const key = useMemo(
    () => [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))].sort().join("|"),
    [ids]
  );
  const [byId, setById] = useState<Map<string, VoucherDocById>>(() => new Map());
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: number | null = null;
    const onBump = (event: Event) => {
      const detail = (event as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (detail?.collection !== "vouchers") return;
      if (detail.companyId && companyId && detail.companyId !== companyId) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setBump((n) => n + 1), 400);
    };
    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    return () => {
      window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [companyId]);

  useEffect(() => {
    const cid = String(companyId || "").trim();
    const fsId = String(fsCompanyId || cid).trim();
    if (!cid || !key) {
      setById((prev) => (prev.size ? new Map() : prev));
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, VoucherDocById>();
      for (const id of key.split("|")) {
        let row: Record<string, unknown> | null = null;
        try {
          row = await getCompanyDocFromBrowserDb(cid, "vouchers", id);
        } catch {
          row = null;
        }
        if (!row && fsId) {
          try {
            const snap = await getDoc(doc(firestore, `companies/${fsId}/vouchers`, id));
            row = snap.exists() ? ((snap.data() as Record<string, unknown>) ?? null) : null;
          } catch {
            row = null;
          }
        }
        if (row && row.isDeleted !== true) next.set(id, { ...row, id });
        if (cancelled) return;
      }
      if (!cancelled) setById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, fsCompanyId, key, bump]);

  return byId;
}
