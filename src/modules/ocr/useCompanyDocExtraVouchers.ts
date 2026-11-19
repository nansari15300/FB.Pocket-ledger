"use client";

import { useEffect, useMemo, useState } from "react";
import { countVoucherAttachmentFiles, isAliveVoucherForFileCount } from "@/modules/ocr/companyFileCountCore";
import {
  COMPANY_DOC_MIN_VISIBLE_FILES,
  countCompanyDocFilesByMonthWindow,
  parseCompanyDocVoucherDateMs,
} from "@/modules/ocr/companyDocDateWindow";
import { listOlderCompanyDocVoucherIds } from "@/modules/ocr/listCompanyDocOlderVouchers";
import { useVouchersByIds, type VoucherDocById } from "@/modules/ocr/useVouchersByIds";

/**
 * Load other-FY (or otherwise out-of-scope) vouchers with files when the
 * default Company Doc window needs earlier files to reach the minimum of 20.
 */
export function useCompanyDocExtraVouchers(
  companyId: string,
  fsCompanyId: string | undefined,
  vouchers: Array<Record<string, unknown> | null | undefined>,
  options: {
    enabled: boolean;
    monthFromMs: number;
    monthToMs: number;
    minCount?: number;
  },
): Map<string, VoucherDocById> {
  const minCount = options.minCount ?? COMPANY_DOC_MIN_VISIBLE_FILES;
  const [ids, setIds] = useState<string[]>([]);
  const scopeKey = useMemo(
    () =>
      (vouchers || [])
        .map((row) => {
          const id = String((row as { id?: unknown } | null)?.id || "").trim();
          if (!id) return "";
          return `${id}:${countVoucherAttachmentFiles(row)}`;
        })
        .filter(Boolean)
        .sort()
        .join("|"),
    [vouchers],
  );

  useEffect(() => {
    const cid = String(companyId || "").trim();
    if (!cid || !options.enabled || !Number.isFinite(options.monthFromMs)) {
      setIds((prev) => (prev.length ? [] : prev));
      return;
    }
    const files: { id: string; dateMs: number }[] = [];
    const exclude = new Set<string>();
    for (const row of vouchers || []) {
      const id = String((row as { id?: unknown } | null)?.id || "").trim();
      if (id) exclude.add(id);
      if (!isAliveVoucherForFileCount(row as Record<string, unknown> | null)) continue;
      const fileCount = countVoucherAttachmentFiles(row);
      if (fileCount <= 0) continue;
      const dateMs = parseCompanyDocVoucherDateMs((row as { date?: unknown } | null)?.date);
      if (dateMs == null) continue;
      for (let i = 0; i < fileCount; i++) files.push({ id: `${id}:${i}`, dateMs });
    }
    const { thisMonth, earlier } = countCompanyDocFilesByMonthWindow(
      files,
      options.monthFromMs,
      options.monthToMs,
    );
    if (thisMonth >= minCount || thisMonth + earlier >= minCount) {
      setIds((prev) => (prev.length ? [] : prev));
      return;
    }
    const needed = minCount - thisMonth - earlier;
    let cancelled = false;
    void listOlderCompanyDocVoucherIds(cid, options.monthFromMs, needed, exclude).then((next) => {
      if (cancelled) return;
      setIds((prev) => (prev.join("|") === next.join("|") ? prev : next));
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, scopeKey, options.enabled, options.monthFromMs, options.monthToMs, minCount]);

  return useVouchersByIds(String(companyId || "").trim(), ids, fsCompanyId);
}
