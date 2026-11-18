/**
 * Per-company counter bumped whenever a ledger page explicitly sets the voucher scope (date
 * range filter / reset to default). Background widens capture it at start and stop as soon as
 * it changes, so a slow "load older months" walk can no longer overwrite the date range the
 * user just picked.
 */
const generations = new Map<string, number>();

export function bumpFyScopeGeneration(companyId: string): number {
  const id = String(companyId || "").trim();
  const next = (generations.get(id) ?? 0) + 1;
  generations.set(id, next);
  return next;
}

export function currentFyScopeGeneration(companyId: string): number {
  return generations.get(String(companyId || "").trim()) ?? 0;
}
