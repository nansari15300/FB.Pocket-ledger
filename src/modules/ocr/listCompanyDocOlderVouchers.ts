"use client";

import { listVouchersFromBrowserDbByDateRange } from "@/lib/fyPagination/voucherQueries";
import { countVoucherAttachmentFiles, isAliveVoucherForFileCount } from "@/modules/ocr/companyFileCountCore";
import { parseCompanyDocVoucherDateMs } from "@/modules/ocr/companyDocDateWindow";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const FLOOR_MS = Date.UTC(1970, 0, 1);

/**
 * Older-than-`beforeMs` alive vouchers that have attachment files, walked
 * newest-first from the local all-FY store. Stops once `neededFiles` is met.
 * Used so Company Doc can backfill to 20 files across fiscal years when the
 * FY-scoped `useVouchers()` list is not enough.
 */
export async function listOlderCompanyDocVoucherIds(
  companyId: string,
  beforeMs: number,
  neededFiles: number,
  excludeIds: ReadonlySet<string>,
): Promise<string[]> {
  const cid = String(companyId || "").trim();
  if (!cid || neededFiles <= 0 || !Number.isFinite(beforeMs)) return [];

  const found: { id: string; dateMs: number; fileCount: number }[] = [];
  let rangeTo = beforeMs - 1;
  let guard = 0;
  while (rangeTo >= FLOOR_MS && guard < 80) {
    guard += 1;
    const rangeFrom = Math.max(FLOOR_MS, rangeTo - YEAR_MS + 1);
    const rows = await listVouchersFromBrowserDbByDateRange(cid, { fromMs: rangeFrom, toMs: rangeTo });
    for (const row of rows) {
      if (!isAliveVoucherForFileCount(row as Record<string, unknown>)) continue;
      const id = String((row as { id?: unknown }).id || "").trim();
      if (!id || excludeIds.has(id)) continue;
      const fileCount = countVoucherAttachmentFiles(row);
      if (fileCount <= 0) continue;
      found.push({
        id,
        dateMs: parseCompanyDocVoucherDateMs((row as { date?: unknown }).date) ?? 0,
        fileCount,
      });
    }
    const totalFiles = found.reduce((sum, row) => sum + row.fileCount, 0);
    if (totalFiles >= neededFiles) break;
    rangeTo = rangeFrom - 1;
  }

  found.sort((a, b) => (b.dateMs - a.dateMs) || a.id.localeCompare(b.id));
  const ids: string[] = [];
  let files = 0;
  for (const row of found) {
    ids.push(row.id);
    files += row.fileCount;
    if (files >= neededFiles) break;
  }
  return ids;
}
