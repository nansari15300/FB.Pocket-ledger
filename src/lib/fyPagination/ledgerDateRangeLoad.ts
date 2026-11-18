"use client";

import type { useFyVoucherScope } from "@/contexts/FyVoucherScopeContext";
import type { CompanyStorageRow } from "@/lib/companyStorageKind";
import { isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";
import {
  buildFiscalMergeFullVoucherScope,
  companyUsesFiscalMergeDividers,
} from "@/lib/fyPagination/fiscalMergeFullVoucherScope";
import { buildScopeWithMinTxnsInFy } from "@/lib/fyPagination/minTxnScope";
import { hasFullLocalLedgerVoucherMirror } from "@/lib/fyPagination/fiscalMergeFullVoucherScope";
import {
  computeEntityClosingBalancesBeforeMs,
  hydrateLedgerHistoryBeforeMs,
  hydrateLedgerOpeningBalances,
  readLocalFyOpeningBalances,
  resolveLedgerDateRangeScope,
} from "@/lib/fyPagination/openingSnapshotHydrate";
import { readyOpeningHydrateResult } from "@/lib/fyPagination/openingSnapshotStatus";
import { listVouchersFromBrowserDbByDateRange } from "@/lib/fyPagination/voucherQueries";
import {
  applyFyScopeFromSqlite,
  scheduleBackgroundOnlineFyRangeHydrate,
} from "@/lib/fyPagination/sqliteFirstFyLoad";
import { notifyBrowserDbCollectionUpdated } from "@/lib/localCompanyDocMirror";
import type { FyDateRangeMs } from "@/lib/fyPagination/types";
import { bumpFyScopeGeneration } from "@/lib/fyPagination/scopeGeneration";

export type FyScopeCompany = CompanyStorageRow & { country?: string };

export type LedgerDateRangeInput = { from?: Date; to?: Date } | undefined;

export function ledgerDateRangeLoadKey(dateRange?: LedgerDateRangeInput): string {
  if (!dateRange?.from && !dateRange?.to) return "default";
  const from = dateRange.from?.getTime() ?? "";
  const to = dateRange.to?.getTime() ?? "";
  return `range:${from}:${to}`;
}

function scheduleBackgroundLocalHistoryHydrate(params: {
  company: FyScopeCompany | null | undefined;
  companyId: string;
  scopeRange: FyDateRangeMs;
  fy: ReturnType<typeof useFyVoucherScope>;
  beforeMs: number;
}): void {
  const { company, companyId, scopeRange, fy, beforeMs } = params;
  if (!companyId || beforeMs <= 0 || isCloudLinkedCompanyStorage(company)) return;

  void (async () => {
    try {
      await hydrateLedgerHistoryBeforeMs(company, companyId, company?.country, beforeMs);
      const rows = await listVouchersFromBrowserDbByDateRange(companyId, scopeRange);
      if (rows.length) {
        fy.mergeHydratedVouchers(rows);
        fy.registerInMemoryVoucherIds(rows.map((v) => String(v.id || "")));
      }
      notifyBrowserDbCollectionUpdated(companyId, "vouchers", {
        immediate: true,
        source: "fy_range_hydrate",
      });
    } catch (err) {
      console.warn("[ledgerDateRangeLoad] background local history hydrate", err);
    }
  })();
}

async function paintScopeOpeningFast(
  company: FyScopeCompany | null | undefined,
  companyId: string,
  scope: Parameters<typeof readLocalFyOpeningBalances>[1],
  fy: ReturnType<typeof useFyVoucherScope>
): Promise<void> {
  const beforeMs = scope.range?.fromMs;
  if (hasFullLocalLedgerVoucherMirror(company, scope) && beforeMs > 0) {
    const computed = await computeEntityClosingBalancesBeforeMs(companyId, beforeMs);
    fy.applyOpeningHydrateResult(readyOpeningHydrateResult(computed));
    return;
  }
  const localOpening = await readLocalFyOpeningBalances(companyId, scope);
  if (localOpening) fy.applyOpeningHydrateResult(localOpening);
  else fy.setOpeningBalancesLoading();
}

function scheduleBackgroundOpeningHydrate(params: {
  company: FyScopeCompany | null | undefined;
  companyId: string;
  scope: Parameters<typeof hydrateLedgerOpeningBalances>[0]["scope"];
  fy: ReturnType<typeof useFyVoucherScope>;
}): void {
  const { company, companyId, scope, fy } = params;
  void hydrateLedgerOpeningBalances({ company, companyId, scope })
    .then((opening) => fy.applyOpeningHydrateResult(opening))
    .catch((err) => {
      console.warn("[ledgerDateRangeLoad] background opening hydrate", err);
    });
}

/** Reset to default current-month scope (+ min 10 txn backfill; may cross FY). */
export async function applyDefaultFyLedgerScope(params: {
  company: FyScopeCompany | null | undefined;
  fy: ReturnType<typeof useFyVoucherScope>;
}): Promise<void> {
  const { company, fy } = params;
  const companyId = String(company?.id || "").trim();
  if (!companyId || !fy.enabled) return;
  bumpFyScopeGeneration(companyId);

  fy.resetScopeState();
  const scope = companyUsesFiscalMergeDividers(company)
    ? buildFiscalMergeFullVoucherScope(company?.country)
    : await buildScopeWithMinTxnsInFy({
        companyId,
        country: company?.country,
      });

  await applyFyScopeFromSqlite({ companyId, fy, scope });
  await paintScopeOpeningFast(company, companyId, scope, fy);

  scheduleBackgroundOnlineFyRangeHydrate({
    company,
    companyId,
    range: scope.range,
    fy,
  });
  scheduleBackgroundOpeningHydrate({ company, companyId, scope, fy });
}

/** User ledger date filter → SQLite first, then background online/local hydrate. */
export async function applyFyLoadForLedgerDateRange(params: {
  company: FyScopeCompany | null | undefined;
  fy: ReturnType<typeof useFyVoucherScope>;
  dateRange?: LedgerDateRangeInput;
}): Promise<void> {
  const { company, fy, dateRange } = params;
  const companyId = String(company?.id || "").trim();
  if (!companyId || !fy.enabled) return;

  if (!dateRange?.from && !dateRange?.to) {
    await applyDefaultFyLedgerScope({ company, fy });
    return;
  }

  const scope = resolveLedgerDateRangeScope(company?.country, dateRange);
  if (!scope) return;
  // Stop any background "load older months" widen so it cannot overwrite this date range.
  bumpFyScopeGeneration(companyId);

  await applyFyScopeFromSqlite({ companyId, fy, scope });
  await paintScopeOpeningFast(company, companyId, scope, fy);

  scheduleBackgroundOnlineFyRangeHydrate({
    company,
    companyId,
    range: scope.range,
    fy,
  });

  if (
    !isCloudLinkedCompanyStorage(company) &&
    scope.periodKind !== "fy" &&
    scope.range.fromMs > 0
  ) {
    scheduleBackgroundLocalHistoryHydrate({
      company,
      companyId,
      scopeRange: scope.range,
      fy,
      beforeMs: scope.range.fromMs,
    });
  }

  scheduleBackgroundOpeningHydrate({ company, companyId, scope, fy });
}
