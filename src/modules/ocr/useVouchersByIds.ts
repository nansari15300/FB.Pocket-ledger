"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import {
  BROWSER_DB_COLLECTION_BUMP,
  getCompanyDocFromBrowserDb,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";
import { fetchVouchersByAnyIds, isGalleryServerApiUnavailable } from "@/modules/ocr/plGalleryServerApi";
import { isAliveRecentOcrVoucher, voucherLookupIds } from "@/modules/ocr/recentOcrLinks";

export type VoucherDocById = Record<string, unknown> & { id: string };

function asVoucher(row: Record<string, unknown>, fallbackId: string): VoucherDocById | null {
  if (!isAliveRecentOcrVoucher(row)) return null;
  const id = String(row.id || row.app_id || fallbackId || "").trim();
  if (!id) return null;
  return { ...row, id };
}

function indexVoucher(map: Map<string, VoucherDocById>, row: VoucherDocById, requestedId?: string) {
  for (const id of voucherLookupIds(row, requestedId)) {
    map.set(id, row);
  }
}

/**
 * Vouchers by id, read straight from the local voucher store (PocketBase as fallback), for ids
 * that are missing from the FY-scoped `useVouchers()` list - e.g. a runner voucher whose bill date
 * is in an older year. Gallery OCR History / Recent OCR Trxn use it so such vouchers still show.
 *
 * Resolves both the app document id (`data.id` / `app_id`) and the PocketBase record id. Missing
 * local rows are fetched from the server hook, then by a direct document read.
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
      const missing: string[] = [];
      for (const id of key.split("|")) {
        let row: Record<string, unknown> | null = null;
        try {
          row = await getCompanyDocFromBrowserDb(cid, "vouchers", id);
        } catch {
          row = null;
        }
        const local = row ? asVoucher(row, id) : null;
        if (local) indexVoucher(next, local, id);
        else missing.push(id);
        if (cancelled) return;
      }
      if (missing.length && !cancelled) {
        try {
          const fromServer = await fetchVouchersByAnyIds(cid, missing);
          for (const id of missing) {
            const hit = fromServer.get(id);
            if (hit && asVoucher(hit, id)) indexVoucher(next, asVoucher(hit, id)!, id);
          }
        } catch (error) {
          if (!isGalleryServerApiUnavailable(error)) {
            console.warn("[useVouchersByIds] server batch lookup failed", error);
          }
        }
      }
      const stillMissing = key.split("|").filter((id) => !next.has(id));
      if (fsId && stillMissing.length && !cancelled) {
        for (const id of stillMissing) {
          try {
            const snap = await getDoc(doc(firestore, `companies/${fsId}/vouchers`, id));
            const data = snap.exists() ? ((snap.data() as Record<string, unknown>) ?? null) : null;
            const remote = data ? asVoucher(data, id) : null;
            if (remote) indexVoucher(next, remote, id);
          } catch {
            /* leave this id missing */
          }
          if (cancelled) return;
        }
      }
      if (!cancelled) setById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, fsCompanyId, key, bump]);

  return byId;
}
