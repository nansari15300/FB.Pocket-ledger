"use client";

import { deserializeLocalDbValue } from "@/lib/localCompanyDocMirror";
import { getBrowserDbForCompanyId } from "@/lib/localSqlite";
import type { FyDateRangeMs } from "@/lib/fyPagination/types";
import { yieldToMain } from "@/lib/yieldToMain";

export type FyVoucherQueryOptions = {
  forBackupMerge?: boolean;
  includeSoftDeleted?: boolean;
};

// JSON revival can be much more expensive than the indexed SQL range query.
// Yield in short slices so a ledger's background FY/history expansion never
// monopolizes the renderer (especially when the same company is open in tabs).
const VOUCHER_PARSE_SLICE_MS = 8;

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function parseVoucherRow(
  row: { id: string; data: string },
  options?: FyVoucherQueryOptions
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    const data = deserializeLocalDbValue(parsed) as Record<string, unknown>;
    if (!options?.includeSoftDeleted && !options?.forBackupMerge && data.isDeleted === true) {
      return null;
    }
    return { ...data, id: row.id };
  } catch {
    return null;
  }
}

/** Vouchers in [fromMs, toMs] via projection index — avoids full table scan parse. */
export async function listVouchersFromBrowserDbByDateRange(
  companyId: string,
  range: FyDateRangeMs,
  options?: FyVoucherQueryOptions
): Promise<any[]> {
  if (typeof window === "undefined" || !companyId) return [];
  const db = await getBrowserDbForCompanyId(companyId);
  if (!db) return [];

  const rows = db
    .prepare(
      `SELECT cd.id, cd.data
       FROM company_docs cd
       INNER JOIN company_docs_projection p
         ON cd.company_id = p.company_id AND cd.collection = p.collection AND cd.id = p.id
       WHERE cd.company_id = ? AND cd.collection = 'vouchers'
         AND p.doc_date_ms IS NOT NULL
         AND p.doc_date_ms >= ? AND p.doc_date_ms <= ?
       ORDER BY p.doc_date_ms ASC`
    )
    .all(companyId, range.fromMs, range.toMs) as Array<{ id: string; data: string }>;

  const out: any[] = [];
  let sliceStartedAt = nowMs();
  for (const row of rows) {
    const doc = parseVoucherRow(row, options);
    if (doc) out.push(doc);

    if (nowMs() - sliceStartedAt >= VOUCHER_PARSE_SLICE_MS) {
      await yieldToMain();
      sliceStartedAt = nowMs();
    }
  }
  return out;
}

/** IDs of vouchers in range without loading full JSON (for link hints). */
export async function listVoucherIdsInDateRange(
  companyId: string,
  range: FyDateRangeMs
): Promise<string[]> {
  if (typeof window === "undefined" || !companyId) return [];
  const db = await getBrowserDbForCompanyId(companyId);
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT id FROM company_docs_projection
         WHERE company_id = ? AND collection = 'vouchers'
           AND doc_date_ms IS NOT NULL
           AND doc_date_ms >= ? AND doc_date_ms <= ?`
      )
      .all(companyId, range.fromMs, range.toMs) as Array<{ id?: string }>;
    return rows.map((r) => String(r.id || "")).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Live (not soft-deleted) vouchers in range. Soft-deleted tombstones keep their projection row,
 * so counting projection ids alone made the default "min 10 txns" scope stop too early
 * (e.g. 1 Sep instead of 1 Aug) and hid in-FY vouchers from ledgers / Gallery Recent OCR.
 */
export async function countVouchersInDateRange(companyId: string, range: FyDateRangeMs): Promise<number> {
  if (typeof window === "undefined" || !companyId) return 0;
  const db = await getBrowserDbForCompanyId(companyId);
  if (!db) return 0;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM company_docs cd
         INNER JOIN company_docs_projection p
           ON cd.company_id = p.company_id AND cd.collection = p.collection AND cd.id = p.id
         WHERE cd.company_id = ? AND cd.collection = 'vouchers'
           AND p.doc_date_ms IS NOT NULL
           AND p.doc_date_ms >= ? AND p.doc_date_ms <= ?
           AND COALESCE(json_extract(cd.data, '$.isDeleted'), 0) NOT IN (1, 'true')`
      )
      .get(companyId, range.fromMs, range.toMs) as { n?: number } | undefined;
    const n = Number(row?.n);
    if (Number.isFinite(n)) return n;
  } catch {
    /* JSON1 unavailable: fall back to the projection id count */
  }
  const ids = await listVoucherIdsInDateRange(companyId, range);
  return ids.length;
}
