/**
 * Drop device copies of Pocket Ledger Server companies that no longer exist on the server
 * (hard-deleted there). Only call after a SUCCESSFUL, NON-EMPTY registry pull.
 * Never touches Firebase, PL Server (gate) or plain Local companies.
 */

import {
  isPocketBaseCompanyId,
  isPocketBaseRootWritePending,
  markPocketBaseCompanyPruned,
  clearPocketBaseCompanyPruned,
  unregisterPocketBaseCompanyId,
  wasPocketBaseCompanyRegisteredRecently,
} from "@/lib/pocketbaseData/pbCompanyRegistry";
import { clearPbOutboxCompanyBlock } from "@/lib/pocketbaseData/pbOutboxBlock";
import { isPocketBaseSelectorCompanyRow, isStrictLocalOnlyCompany, isServerGateCompany } from "@/lib/companyStorageKind";
import { isLocalCompanyVisibleToAppAccount } from "@/lib/localCompanyMembership";
import { listLocalCompanies, removeLocalCompanyById } from "@/lib/localCompanyStore";
import { getBrowserDbForCompanyId } from "@/lib/localSqlite";

const CURSOR_KEY_PREFIX = "pl_pb_pull_cursor_v1:";
/** A company created / restored in the last minutes may not be listed by a pull that started earlier. */
const NEW_COMPANY_GRACE_MS = 10 * 60_000;

function toMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof v === "object") {
    const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === "function") {
      try {
        return o.toMillis();
      } catch {
        return 0;
      }
    }
    const s = o.seconds ?? o._seconds;
    if (typeof s === "number") return s * 1000;
  }
  return 0;
}

/** "none" = safe, "pending" = unsynced rows, "unknown" = could not check (treated as do-not-prune). */
async function outboxState(companyId: string): Promise<"none" | "pending" | "unknown"> {
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return "unknown";
    const row = db.prepare(`SELECT COUNT(1) as c FROM sync_outbox WHERE company_id = ?`).get(companyId) as
      | { c?: number }
      | undefined;
    return Number(row?.c ?? 0) > 0 ? "pending" : "none";
  } catch {
    return "unknown";
  }
}

function clearPullCursors(companyId: string): void {
  if (typeof window === "undefined") return;
  try {
    const suffix = `:${companyId}`;
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(CURSOR_KEY_PREFIX) && k.endsWith(suffix)) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
    window.localStorage.removeItem(CURSOR_KEY_PREFIX + companyId); // legacy device-wide key
  } catch {
    /* ignore */
  }
}

export async function prunePocketBaseCompaniesMissingOnServer(args: {
  /** Every app company id the server returned (soft-deleted too). Must come from a successful pull. */
  serverIds: ReadonlySet<string>;
  user: { uid?: string | null; email?: string | null } | null | undefined;
  activeCompanyId?: string | null;
}): Promise<{ prunedIds: string[]; activePruned: boolean }> {
  const out = { prunedIds: [] as string[], activePruned: false };
  const { serverIds, user } = args;
  // Never prune on an empty response (server hiccup / rules change / wrong account).
  if (!serverIds || serverIds.size === 0 || !user?.uid) return out;
  for (const id of serverIds) clearPocketBaseCompanyPruned(id);

  let local: Array<Record<string, unknown>> = [];
  try {
    local = (await listLocalCompanies()) as unknown as Array<Record<string, unknown>>;
  } catch {
    return out;
  }
  const active = String(args.activeCompanyId || "").trim();
  const seen = new Set<string>();
  for (const c of local) {
    const id = String(c?.id || "").trim();
    if (!id || seen.has(id) || serverIds.has(id)) continue;
    seen.add(id);
    const row = c as never;
    const isPb = isPocketBaseCompanyId(id) || isPocketBaseSelectorCompanyRow(row);
    if (!isPb) continue;
    if (isStrictLocalOnlyCompany(row) || isServerGateCompany(row)) continue;
    if ((c as { plServerShared?: unknown }).plServerShared === true) continue;
    // Another account's company on this device: not in this account's server list by design.
    if (!isLocalCompanyVisibleToAppAccount(row, user)) continue;
    // Being created / restored, or has a pending root write / dirty root.
    if (isPocketBaseRootWritePending(id)) continue;
    if (wasPocketBaseCompanyRegisteredRecently(id, NEW_COMPANY_GRACE_MS)) continue;
    const createdMs = toMs((c as { createdAt?: unknown }).createdAt);
    if (createdMs && Date.now() - createdMs < NEW_COMPANY_GRACE_MS) continue;
    try {
      const { isPocketBaseCompanyRootDirty, resetPocketBaseCompanySyncState } = await import(
        "@/lib/pocketbaseData/pbSync"
      );
      if (isPocketBaseCompanyRootDirty(id)) continue;
      // Unsynced local edits must never be thrown away.
      if ((await outboxState(id)) !== "none") continue;

      await removeLocalCompanyById(id, { firebaseUid: user.uid });
      markPocketBaseCompanyPruned(id);
      unregisterPocketBaseCompanyId(id);
      resetPocketBaseCompanySyncState(id);
      clearPullCursors(id);
      // Disable the outbox for the pruned company: drop its in-memory block/backoff and any leftover
      // (orphan) outbox rows enqueued after the emptiness check. Rows of a company that still HAS
      // unsynced edits never reach this point (outboxState above), they stay blocked instead.
      clearPbOutboxCompanyBlock(id);
      try {
        const odb = await getBrowserDbForCompanyId(id);
        odb?.prepare(`DELETE FROM sync_outbox WHERE company_id = ?`).run(id);
      } catch {
        /* best effort */
      }
      out.prunedIds.push(id);
      if (active && active === id) out.activePruned = true;
      console.info(
        `[useCompany] pruned Pocket Ledger Server company missing on server: ${id} (${String(c?.name || "").slice(0, 80)})`
      );
    } catch (e) {
      console.warn("[useCompany] prune of server-deleted company failed", id, e);
    }
  }
  return out;
}