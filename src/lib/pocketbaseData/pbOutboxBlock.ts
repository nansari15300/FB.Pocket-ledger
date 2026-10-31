/**
 * In-memory failure memory for the Pocket Ledger Server (PocketBase) outbox flush.
 *
 * Why: a company that is missing on the server answers `POST /api/pl/data/batch` with
 * 404 "company not found" for EVERY row. The flush loop used to retry every row of that
 * company on every tick (8s interval + 2/4/8s fail retries) => tens of thousands of 404s.
 *
 *  - Company block: after a permanent "company missing / no access" answer the whole company is
 *    skipped (exponential backoff, 1 min .. 30 min) and only re-probed with a cheap lookup.
 *    It is lifted when the company is found on the server again, when the user presses retry
 *    (requeueFailedOutboxRows), or after an app restart (memory only) - then the first row
 *    fails once and the company is blocked again.
 *  - Row backoff: any other failing row waits 5s, 10s, 20s ... up to 10 min before the next attempt.
 *
 * No imports on purpose (no cycles); state is per page session.
 */

export type PbOutboxCompanyBlock = {
  until: number;
  fails: number;
  reason: string;
  since: number;
};

const COMPANY_BACKOFF_MIN_MS = 60_000;
const COMPANY_BACKOFF_MAX_MS = 30 * 60_000;
const ROW_BACKOFF_MIN_MS = 5_000;
const ROW_BACKOFF_MAX_MS = 10 * 60_000;

const companyBlocks = new Map<string, PbOutboxCompanyBlock>();
const rowBackoff = new Map<string, { fails: number; until: number }>();
const loggedCompanies = new Set<string>();

/** Prefix written to sync_outbox.last_error for rows of a blocked company. */
export const PB_OUTBOX_BLOCKED_PREFIX = "[blocked] ";

/** 404 "company not found" (or the client-side equivalent) / 403 no access: retrying cannot succeed. */
export function isPocketBaseCompanyMissingError(e: unknown): boolean {
  const status = Number((e as { status?: number })?.status ?? 0);
  const msg = String((e as { message?: string })?.message ?? "").toLowerCase();
  if (status === 404) return msg.includes("company not found") || msg.includes("not on the server");
  if (status === 403) return msg.includes("no write access") || msg.includes("not a member");
  return false;
}

export function getPbOutboxCompanyBlock(companyId: string): PbOutboxCompanyBlock | null {
  return companyBlocks.get(companyId) ?? null;
}

/** Block (or extend the block of) a company. `first` = this call created the block (log once). */
export function blockPbOutboxCompany(companyId: string, reason: string): { first: boolean; block: PbOutboxCompanyBlock } {
  const now = Date.now();
  const prev = companyBlocks.get(companyId);
  const fails = (prev?.fails ?? 0) + 1;
  const wait = Math.min(COMPANY_BACKOFF_MIN_MS * 2 ** (fails - 1), COMPANY_BACKOFF_MAX_MS);
  const block: PbOutboxCompanyBlock = { until: now + wait, fails, reason, since: prev?.since ?? now };
  companyBlocks.set(companyId, block);
  const first = !loggedCompanies.has(companyId);
  loggedCompanies.add(companyId);
  return { first, block };
}

/** Probe could not decide (network): retry the probe soon without escalating the backoff. */
export function deferPbOutboxCompanyProbe(companyId: string, ms = 30_000): void {
  const b = companyBlocks.get(companyId);
  if (b) b.until = Date.now() + ms;
}

/** Lift the block (company found again / user retry / company forgotten). No id = all companies. */
export function clearPbOutboxCompanyBlock(companyId?: string): void {
  if (!companyId) {
    companyBlocks.clear();
    rowBackoff.clear();
    loggedCompanies.clear();
    return;
  }
  companyBlocks.delete(companyId);
  loggedCompanies.delete(companyId);
}

export function isPbOutboxRowBackedOff(outboxId: string): boolean {
  const r = rowBackoff.get(outboxId);
  return !!r && Date.now() < r.until;
}

export function notePbOutboxRowFailure(outboxId: string): number {
  const fails = (rowBackoff.get(outboxId)?.fails ?? 0) + 1;
  const wait = Math.min(ROW_BACKOFF_MIN_MS * 2 ** (fails - 1), ROW_BACKOFF_MAX_MS);
  rowBackoff.set(outboxId, { fails, until: Date.now() + wait });
  if (rowBackoff.size > 5000) {
    const now = Date.now();
    for (const [k, v] of rowBackoff) if (v.until < now) rowBackoff.delete(k);
  }
  return wait;
}

export function clearPbOutboxRowBackoff(outboxId: string): void {
  rowBackoff.delete(outboxId);
}
const SERVER_BACKOFF_MIN_MS = 5_000;
const SERVER_BACKOFF_MAX_MS = 2 * 60_000;
let serverDownFails = 0;
let serverDownUntil = 0;

/** Server unreachable / 5xx: stop hammering it for every queued row (exponential, 5s .. 2 min). */
export function notePbServerDown(): void {
  serverDownFails += 1;
  serverDownUntil = Date.now() + Math.min(SERVER_BACKOFF_MIN_MS * 2 ** (serverDownFails - 1), SERVER_BACKOFF_MAX_MS);
}

export function isPbServerBackedOff(): boolean {
  return Date.now() < serverDownUntil;
}

export function clearPbServerBackoff(): void {
  serverDownFails = 0;
  serverDownUntil = 0;
}