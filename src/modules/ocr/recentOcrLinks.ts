/** OCR-created voucher links used by Gallery > Recent OCR Trxn. */

export type RecentOcrLink = {
  voucherId: string;
  provider: string;
  mode: string;
};

export function normalizeRecentOcrLink(raw: {
  voucherId?: unknown;
  autoOcrVoucherId?: unknown;
  provider?: unknown;
  autoOcrProvider?: unknown;
  mode?: unknown;
  autoOcrRunnerMode?: unknown;
}): RecentOcrLink | null {
  const voucherId = String(raw.voucherId || raw.autoOcrVoucherId || "").trim();
  if (!voucherId) return null;
  return {
    voucherId,
    provider: String(raw.provider || raw.autoOcrProvider || "").trim(),
    mode: String(raw.mode || raw.autoOcrRunnerMode || "").trim(),
  };
}

/** Last write wins for the same voucher id (later links overwrite provider/mode). */
export function mergeRecentOcrLinks(groups: Array<Iterable<RecentOcrLink | null | undefined>>): RecentOcrLink[] {
  const byId = new Map<string, RecentOcrLink>();
  for (const group of groups) {
    for (const raw of group) {
      if (!raw) continue;
      const link = normalizeRecentOcrLink(raw);
      if (link) byId.set(link.voucherId, link);
    }
  }
  return [...byId.values()];
}

export function isAliveRecentOcrVoucher(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row.isDeleted === true || row.deleted === true || row._pbHardDeleted === true) return false;
  return true;
}

/** Collect both the app id and a PocketBase record id so lookups can use either. */
export function voucherLookupIds(row: Record<string, unknown> | null | undefined, requestedId?: string): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const id = String(value || "").trim();
    if (id) ids.add(id);
  };
  add(requestedId);
  if (!row) return [...ids];
  add(row.id);
  add(row.app_id);
  add((row as { appId?: unknown }).appId);
  add((row as { _pbId?: unknown })._pbId);
  add((row as { pbId?: unknown }).pbId);
  add((row as { recordId?: unknown }).recordId);
  return [...ids];
}
