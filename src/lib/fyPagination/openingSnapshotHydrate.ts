"use client";

import { endOfDay, startOfDay } from "date-fns";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import type { Context } from "@/components/vouchers/TransactionsTable";
import { getTransactionAmounts } from "@/hooks/use-transactions";
import { isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";
import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import type { CompanyStorageRow } from "@/lib/companyStorageKind";
import { firestore } from "@/lib/plClientSession";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { fetchServerFyClosingSnapshot } from "@/lib/fyPagination/serverFyClosingSnapshotClient";
import { fySnapshotDocPath } from "@/lib/ledgerModes/online/fyMonthQueries";
import { hydrateOnlineVoucherRangeFromFirestore } from "@/lib/ledgerModes/online/fyMonthHydrate";
import { buildPartyLedgerAggregateMap } from "@/lib/partyListLedgerBalance";
import {
  currentFiscalYearRange,
  fiscalYearRangeForKey,
  monthPeriodKey,
  priorFyKeyFromRunning,
} from "@/lib/fyPagination/periodBounds";
import {
  isLedgerDateFilterFromAtFyStart,
  normalizeFyOpeningBalances,
  resolveOpeningSnapshotKind,
} from "@/lib/fyPagination/ledgerOpeningMeta";
import { openingBoundaryPeriodKey } from "@/lib/fyPagination/openingBoundaryKeys";
import {
  effectiveOpeningBalanceDateBeforeMs,
  isLedgerTransactionOnOrAfterOpeningDate,
} from "@/lib/fyPagination/ledgerOpeningDateFilter";
import {
  readyOpeningHydrateResult,
  unavailableOpeningHydrateResult,
  type LedgerOpeningHydrateResult,
} from "@/lib/fyPagination/openingSnapshotStatus";
import { hasFullLocalLedgerVoucherMirror } from "@/lib/fyPagination/fiscalMergeFullVoucherScope";
import { readFyBalanceSnapshot, writeFyBalanceSnapshot } from "@/lib/fyPagination/snapshotStore";
import type { FyActiveScope, FyBalanceSnapshot, FyDateRangeMs, FyPeriodKind } from "@/lib/fyPagination/types";
import { getAnusuchi13FyKey } from "@/lib/reports/anusuchi13Confirmation";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";

export type FyScopeCompany = CompanyStorageRow & { country?: string };

type LedgerMasterRow = {
  id: string;
  context: Context;
  openingBalance?: unknown;
  openingBalanceDate?: unknown;
};

function voucherJsDate(date: unknown): Date | null {
  return parseFirestoreDateFieldToJsDate(date);
}

async function fetchFyBalanceSnapshotFromFirestore(
  fsCompanyId: string,
  periodKind: FyPeriodKind,
  periodKey: string,
  expectedBeforeMs?: number
): Promise<FyBalanceSnapshot | null> {
  if (!fsCompanyId || !periodKey) return null;
  if (isPocketBaseCompanyId(fsCompanyId)) return null;
  try {
    const path = fySnapshotDocPath(fsCompanyId, periodKind, periodKey);
    const snap = await getDoc(doc(firestore, path));
    if (!snap.exists()) return null;
    const data = snap.data() as {
      closingAtMs?: number;
      beforeMs?: number;
      balances?: Record<string, number>;
      updatedAtMs?: number;
      computedOnServer?: boolean;
      stale?: boolean;
      voucherCountScanned?: number;
    };
    if (data.stale === true || data.computedOnServer !== true) return null;
    const storedBeforeMs = Number(data.beforeMs) || 0;
    if (
      expectedBeforeMs &&
      storedBeforeMs > 0 &&
      Math.abs(storedBeforeMs - expectedBeforeMs) > 1
    ) {
      return null;
    }
    return {
      companyId: fsCompanyId,
      periodKind,
      periodKey,
      closingAtMs: Number(data.closingAtMs) || 0,
      balances: data.balances ?? {},
      updatedAtMs: Number(data.updatedAtMs) || Date.now(),
      computedOnServer: data.computedOnServer === true,
      voucherCountScanned: Number(data.voucherCountScanned) || 0,
    };
  } catch {
    return null;
  }
}

async function loadLedgerMasters(companyId: string): Promise<LedgerMasterRow[]> {
  const [parties, accounts, staff, taxes, expenses, items] = await Promise.all([
    listCompanyDocsFromBrowserDb(companyId, "parties"),
    listCompanyDocsFromBrowserDb(companyId, "bank_accounts"),
    listCompanyDocsFromBrowserDb(companyId, "staff"),
    listCompanyDocsFromBrowserDb(companyId, "taxes"),
    listCompanyDocsFromBrowserDb(companyId, "expense_accounts"),
    listCompanyDocsFromBrowserDb(companyId, "items"),
  ]);

  const rows: LedgerMasterRow[] = [];
  const push = (list: Array<Record<string, unknown>>, context: Context) => {
    for (const row of list) {
      const id = String(row.id || "").trim();
      if (!id || row.isDeleted === true) continue;
      rows.push({
        id,
        context,
        openingBalance: row.openingBalance,
        openingBalanceDate: row.openingBalanceDate,
      });
    }
  };
  push(parties as Array<Record<string, unknown>>, "party");
  push(accounts as Array<Record<string, unknown>>, "account");
  push(staff as Array<Record<string, unknown>>, "staff");
  push(taxes as Array<Record<string, unknown>>, "tax");
  push(expenses as Array<Record<string, unknown>>, "expense");
  push(items as Array<Record<string, unknown>>, "item");
  return rows;
}

/** Full SQLite mirror scan — projection index can miss back-dated / pre-scope vouchers. */
async function listVouchersBeforeMs(companyId: string, beforeMs: number): Promise<any[]> {
  const all = await listCompanyDocsFromBrowserDb(companyId, "vouchers");
  return all.filter((v) => {
    if (v?.isDeleted === true) return false;
    const d = voucherJsDate(v?.date);
    return d && startOfDay(d).getTime() < beforeMs;
  });
}

/** Online: hydrate each FY chunk before filter start (book OB era + Chaitra sale, etc.). */
export async function hydrateLedgerHistoryBeforeMs(
  company: FyScopeCompany | null | undefined,
  companyId: string,
  country: string | undefined,
  beforeMs: number
): Promise<void> {
  if (!beforeMs || beforeMs <= 0) return;
  if (!isCloudLinkedCompanyStorage(company)) return;
  const fsCompanyId = String(company?.authoritativeCompanyId || companyId).trim();
  if (!fsCompanyId) return;

  const seenFyKeys = new Set<string>();
  let cursorDate = new Date(beforeMs - 1);

  for (let i = 0; i < 50; i++) {
    const fyKey = getAnusuchi13FyKey(country, cursorDate);
    if (seenFyKeys.has(fyKey)) break;
    seenFyKeys.add(fyKey);

    const range = fiscalYearRangeForKey(country, fyKey);
    if (!range) break;

    const hydrateToMs = Math.min(range.toMs, beforeMs - 1);
    if (hydrateToMs >= range.fromMs) {
      await hydrateOnlineVoucherRangeFromFirestore({
        companyId,
        fsCompanyId,
        range: { fromMs: range.fromMs, toMs: hydrateToMs },
      }).catch((err) => {
        console.warn("[openingSnapshotHydrate] FY chunk hydrate", fyKey, err);
      });
    }

    if (range.fromMs <= 0 || range.fromMs >= beforeMs) break;
    cursorDate = new Date(range.fromMs - 86400000);
  }
}

async function hydratePriorPeriodVouchersForOpening(
  company: FyScopeCompany | null | undefined,
  companyId: string,
  scope: FyActiveScope
): Promise<void> {
  if (isCloudLinkedCompanyStorage(company)) return;
  const beforeMs = scope.range.fromMs;
  if (!beforeMs || beforeMs <= 0) return;
  await hydrateLedgerHistoryBeforeMs(company, companyId, company?.country, beforeMs);
}

/** Ledger opening parity — same carry math as `useTransactions` pre-period reduce. */
export async function computeEntityClosingBalancesBeforeMs(
  companyId: string,
  beforeMs: number,
  processedTaxes: unknown[] = []
): Promise<Record<string, number>> {
  if (!companyId || !Number.isFinite(beforeMs) || beforeMs <= 0) return {};

  const vouchers = await listVouchersBeforeMs(companyId, beforeMs);
  const sorted = [...vouchers].sort((a, b) => {
    const am = voucherJsDate(a.date)?.getTime() ?? 0;
    const bm = voucherJsDate(b.date)?.getTime() ?? 0;
    return am - bm;
  });

  const masters = await loadLedgerMasters(companyId);
  const balances: Record<string, number> = {};

  const partyMasters = masters.filter((m) => m.context === "party");

  for (const master of partyMasters) {
    const openingBalanceDate = voucherJsDate(master.openingBalanceDate);
    const effectiveOpeningBalanceDate = effectiveOpeningBalanceDateBeforeMs(
      openingBalanceDate,
      beforeMs,
      true
    );
    const partyVouchers = sorted.filter((t) => {
      const transactionDate = voucherJsDate(t.date);
      if (!transactionDate) return false;
      if (!isLedgerTransactionOnOrAfterOpeningDate(transactionDate, effectiveOpeningBalanceDate)) {
        return false;
      }
      if (startOfDay(transactionDate).getTime() >= beforeMs) return false;
      return true;
    });
    const agg = buildPartyLedgerAggregateMap(partyVouchers, new Set([master.id]));
    const row = agg.get(master.id) || { debit: 0, credit: 0 };
    const booksOb = Number(master.openingBalance) || 0;
    balances[master.id] = booksOb + row.debit - row.credit;
  }

  for (const master of masters.filter((m) => m.context !== "party")) {
    let balance = Number(master.openingBalance) || 0;
    const openingBalanceDate = voucherJsDate(master.openingBalanceDate);
    const effectiveOpeningBalanceDate = effectiveOpeningBalanceDateBeforeMs(
      openingBalanceDate,
      beforeMs,
      true
    );

    for (const t of sorted) {
      const transactionDate = voucherJsDate(t.date);
      if (!transactionDate) continue;
      if (!isLedgerTransactionOnOrAfterOpeningDate(transactionDate, effectiveOpeningBalanceDate)) {
        continue;
      }
      if (startOfDay(transactionDate).getTime() >= beforeMs) continue;

      const amounts = getTransactionAmounts(
        t,
        master.context,
        { id: master.id },
        "amount",
        undefined,
        processedTaxes as any[]
      );
      balance += amounts.debit - amounts.credit;
    }

    balances[master.id] = balance;
  }

  return balances;
}

/** Local SQLite cache only — Firestore fySnapshots sirf server API likhe (galat client BO cache na ho). */
async function persistFyOpeningSnapshotLocal(snapshot: FyBalanceSnapshot): Promise<void> {
  await writeFyBalanceSnapshot(snapshot);
}

/**
 * Opening balances for active scope.
 * Online: Firebase Admin API paginates vouchers → fySnapshots (no prior voucher load on device).
 * Offline/local: SQLite mirror + optional Firestore doc read.
 */
/** Cached SQLite FY opening snapshot — instant paint on refresh before server read. */
export async function readLocalFyOpeningBalances(
  companyId: string,
  scope: FyActiveScope
): Promise<LedgerOpeningHydrateResult | null> {
  if (!companyId || !scope.openingSnapshotId) return null;
  const openingKind = resolveOpeningSnapshotKind(scope.openingSnapshotId);
  const periodKey = scope.openingSnapshotId;
  const localSnap = await readFyBalanceSnapshot(companyId, openingKind, periodKey);
  const fromLocal = normalizeFyOpeningBalances(localSnap?.balances ?? {});
  if (Object.keys(fromLocal).length > 0) return readyOpeningHydrateResult(fromLocal);
  return null;
}

async function computeAndCacheOpeningFromSqliteMirror(params: {
  company: FyScopeCompany | null | undefined;
  companyId: string;
  scope: FyActiveScope;
  beforeMs: number;
  openingKind: FyPeriodKind;
  periodKey: string;
}): Promise<LedgerOpeningHydrateResult | null> {
  const { company, companyId, scope, beforeMs, openingKind, periodKey } = params;
  if (!hasFullLocalLedgerVoucherMirror(company, scope) || !beforeMs) return null;

  const computed = await computeEntityClosingBalancesBeforeMs(companyId, beforeMs);
  if (Object.keys(computed).length > 0 && periodKey) {
    const closingAtMs =
      openingKind === "fy"
        ? fiscalYearRangeForKey(company?.country, periodKey)?.toMs ?? beforeMs - 1
        : beforeMs - 1;
    void persistFyOpeningSnapshotLocal({
      companyId,
      periodKind: openingKind,
      periodKey,
      closingAtMs,
      balances: computed,
      updatedAtMs: Date.now(),
    });
  }
  return readyOpeningHydrateResult(computed);
}

export async function hydrateLedgerOpeningBalances(params: {
  company: FyScopeCompany | null | undefined;
  companyId: string;
  scope: FyActiveScope;
}): Promise<LedgerOpeningHydrateResult> {
  const { company, companyId, scope } = params;
  const beforeMs = scope.range.fromMs;
  const openingSnapshotId = scope.openingSnapshotId;
  const openingKind = openingSnapshotId
    ? resolveOpeningSnapshotKind(openingSnapshotId)
    : "month";
  const periodKey = openingSnapshotId ?? "";

  if (!companyId) return unavailableOpeningHydrateResult();

  if (hasFullLocalLedgerVoucherMirror(company, scope) && beforeMs > 0) {
    const fromMirror = await computeAndCacheOpeningFromSqliteMirror({
      company,
      companyId,
      scope,
      beforeMs,
      openingKind,
      periodKey: periodKey || openingBoundaryPeriodKey(beforeMs),
    });
    if (fromMirror) return fromMirror;
  }

  if (!openingSnapshotId) return unavailableOpeningHydrateResult();

  const forceServerRebuild = scope.policy === "date_range" && scope.periodKind === "fy";

  if (isCloudLinkedCompanyStorage(company)) {
    if (!forceServerRebuild) {
      const fsCompanyId = String(company?.authoritativeCompanyId || companyId).trim();
      const remote = await fetchFyBalanceSnapshotFromFirestore(
        fsCompanyId,
        openingKind,
        periodKey,
        beforeMs
      );
      const fromRemote = normalizeFyOpeningBalances(remote?.balances ?? {});
      if (remote?.computedOnServer === true && Object.keys(fromRemote).length > 0) {
        await writeFyBalanceSnapshot({ ...remote!, companyId });
        return readyOpeningHydrateResult(fromRemote);
      }
    }

    const server = await fetchServerFyClosingSnapshot({
      companyId,
      periodKind: openingKind,
      periodKey,
      beforeMs,
      forceRebuild: forceServerRebuild,
    });
    if (server && Object.keys(server.balances).length > 0) {
      const normalized = normalizeFyOpeningBalances(server.balances);
      const snapshot: FyBalanceSnapshot = {
        companyId,
        periodKind: openingKind,
        periodKey,
        closingAtMs: server.closingAtMs,
        beforeMs,
        balances: normalized,
        updatedAtMs: Date.now(),
        computedOnServer: true,
        voucherCountScanned: server.voucherCountScanned,
        preFyVoucherCountScanned: server.preFyVoucherCountScanned,
      };
      await writeFyBalanceSnapshot(snapshot);
      return readyOpeningHydrateResult(normalized);
    }

    return unavailableOpeningHydrateResult();
  }

  if (!forceServerRebuild) {
    const localSnap = await readFyBalanceSnapshot(companyId, openingKind, periodKey);
    const fromLocal = normalizeFyOpeningBalances(localSnap?.balances ?? {});
    if (Object.keys(fromLocal).length > 0) return readyOpeningHydrateResult(fromLocal);
  }

  await hydratePriorPeriodVouchersForOpening(company, companyId, scope);
  const computed = await computeEntityClosingBalancesBeforeMs(companyId, beforeMs);

  if (Object.keys(computed).length > 0) {
    const closingAtMs =
      openingKind === "fy"
        ? fiscalYearRangeForKey(company?.country, periodKey)?.toMs ?? beforeMs - 1
        : beforeMs - 1;
    const snapshot: FyBalanceSnapshot = {
      companyId,
      periodKind: openingKind,
      periodKey,
      closingAtMs,
      balances: computed,
      updatedAtMs: Date.now(),
    };
    await persistFyOpeningSnapshotLocal(snapshot);
  }

  return readyOpeningHydrateResult(computed);
}

/** Scope metadata when user picks a ledger date range (F Y preset vs mid-period). */
export function resolveLedgerDateRangeScope(
  country?: string,
  dateRange?: { from?: Date; to?: Date }
): Omit<FyActiveScope, "range"> & { range: FyDateRangeMs } | null {
  if (!dateRange?.from && !dateRange?.to) return null;
  const from = dateRange.from ?? dateRange.to!;
  const to = dateRange.to ?? dateRange.from!;
  const range: FyDateRangeMs = {
    fromMs: startOfDay(from).getTime(),
    toMs: endOfDay(to).getTime(),
  };

  const atFyStart = isLedgerDateFilterFromAtFyStart(country, dateRange);
  if (atFyStart) {
    const fyKey = getAnusuchi13FyKey(country, from);
    const priorFyKey = priorFyKeyFromRunning(fyKey);
    const fyRange = currentFiscalYearRange(country, from);
    return {
      policy: "date_range",
      periodKind: "fy",
      periodKey: fyKey,
      range,
      openingSnapshotId: priorFyKey,
      fyFloorMs: fyRange.fromMs,
    };
  }

  return {
    policy: "date_range",
    periodKind: "month",
    periodKey: `${monthPeriodKey(from)}_${monthPeriodKey(to)}`,
    range,
    openingSnapshotId: openingBoundaryPeriodKey(range.fromMs),
    fyFloorMs: null,
  };
}
