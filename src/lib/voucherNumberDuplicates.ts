"use client";

/**
 * Read-only report of duplicate voucher numbers already in the local Book
 * (SQLite mirror + unsynced outbox). Does not renumber or write anything.
 */

import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { readPendingOutboxPayloadsForCompany } from "@/lib/localVoucherOutbox";
import {
  findDuplicateVoucherNumberGroups,
  type DuplicateVoucherNumberGroup,
} from "@/lib/voucherNumbering";

export type { DuplicateVoucherNumberGroup };

export async function listLocalDuplicateVoucherNumbers(
  companyId: string
): Promise<DuplicateVoucherNumberGroup[]> {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  const rows = (await listCompanyDocsFromBrowserDb(cid, "vouchers", {
    forBackupMerge: true,
  })) as Array<Record<string, unknown>>;
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = String(row.id || "").trim();
    if (id) byId.set(id, row);
  }
  try {
    const pending = await readPendingOutboxPayloadsForCompany(cid, "vouchers");
    for (const [id, payload] of pending) {
      const prev = byId.get(id);
      byId.set(id, { ...(prev || {}), ...payload, id });
    }
  } catch {
    /* outbox optional */
  }
  return findDuplicateVoucherNumberGroups([...byId.values()]);
}
