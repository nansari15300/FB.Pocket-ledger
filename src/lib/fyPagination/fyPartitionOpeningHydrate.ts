"use client";

import { startOfDay } from "date-fns";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";
import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import type { CompanyStorageRow } from "@/lib/companyStorageKind";
import { firestore } from "@/lib/firebase";
import { fetchServerFyClosingSnapshot } from "@/lib/fyPagination/serverFyClosingSnapshotClient";
import { fySnapshotDocPath } from "@/lib/ledgerModes/online/fyMonthQueries";
import {
  extractEntityBalanceFromFySnapshot,
  normalizeFyOpeningBalances,
} from "@/lib/fyPagination/ledgerOpeningMeta";
import {
  readyOpeningHydrateResult,
  unavailableOpeningHydrateResult,
  type FyPartitionOpeningLoadResult,
  type LedgerOpeningHydrateResult,
} from "@/lib/fyPagination/openingSnapshotStatus";
import { hasFullLocalLedgerVoucherMirror } from "@/lib/fyPagination/fiscalMergeFullVoucherScope";
import { computeEntityClosingBalancesBeforeMs } from "@/lib/fyPagination/openingSnapshotHydrate";
import { fiscalYearRangeForKey, priorFyKeyFromRunning } from "@/lib/fyPagination/periodBounds";
import type { FyActiveScope } from "@/lib/fyPagination/types";
import { readFyBalanceSnapshot, writeFyBalanceSnapshot } from "@/lib/fyPagination/snapshotStore";
import type { FyBalanceSnapshot } from "@/lib/fyPagination/types";
import { getAnusuchi13FyKey } from "@/lib/reports/anusuchi13Confirmation";

export type FyPartitionOpeningCompany = CompanyStorageRow & { country?: string };

async function readLocalPriorFyOpeningBalances(params: {
  companyId: string;
  priorFyKey: string;
}): Promise<LedgerOpeningHydrateResult | null> {
  const cid = String(params.companyId || "").trim();
  const priorFyKey = String(params.priorFyKey || "").trim();
  if (!cid || !priorFyKey) return null;

  const local = await readFyBalanceSnapshot(cid, "fy", priorFyKey);
  const fromLocal = normalizeFyOpeningBalances(local?.balances ?? {});
  if (Object.keys(fromLocal).length > 0) {
    return readyOpeningHydrateResult(fromLocal);
  }
  return null;
}

async function hydratePriorFyOpeningBalancesFromServer(params: {
  company: FyPartitionOpeningCompany | null | undefined;
  companyId: string;
  priorFyKey: string;
  beforeMs: number;
}): Promise<LedgerOpeningHydrateResult> {
  const { company, companyId, priorFyKey, beforeMs } = params;
  const cid = String(companyId || "").trim();
  if (!cid || !priorFyKey) return unavailableOpeningHydrateResult();

  if (isCloudLinkedCompanyStorage(company) && !isPocketBaseCompanyId(cid)) {
    const fsCompanyId = String(company?.authoritativeCompanyId || cid).trim();
    if (fsCompanyId && !isPocketBaseCompanyId(fsCompanyId)) {
      try {
        const path = fySnapshotDocPath(fsCompanyId, "fy", priorFyKey);
        const snap = await getDoc(doc(firestore, path));
        if (snap.exists()) {
          const data = snap.data() as {
            balances?: Record<string, number>;
            computedOnServer?: boolean;
            stale?: boolean;
            beforeMs?: number;
            closingAtMs?: number;
            updatedAtMs?: number;
            voucherCountScanned?: number;
          };
          const storedBefore = Number(data.beforeMs) || 0;
          if (
            data.stale !== true &&
            data.computedOnServer === true &&
            (!storedBefore || Math.abs(storedBefore - beforeMs) <= 1)
          ) {
            const fromRemote = normalizeFyOpeningBalances(data.balances ?? {});
            if (Object.keys(fromRemote).length > 0) {
              const snapshot: FyBalanceSnapshot = {
                companyId: cid,
                periodKind: "fy",
                periodKey: priorFyKey,
                closingAtMs: Number(data.closingAtMs) || beforeMs - 1,
                beforeMs: storedBefore || beforeMs,
                balances: fromRemote,
                updatedAtMs: Number(data.updatedAtMs) || Date.now(),
                computedOnServer: true,
                voucherCountScanned: Number(data.voucherCountScanned) || 0,
              };
              await writeFyBalanceSnapshot(snapshot);
              return readyOpeningHydrateResult(fromRemote);
            }
          }
        }
      } catch {
        /* fall through to server rebuild */
      }
    }

    const server = await fetchServerFyClosingSnapshot({
      companyId: cid,
      periodKind: "fy",
      periodKey: priorFyKey,
      beforeMs,
      forceRebuild: false,
    });
    if (server && Object.keys(server.balances).length > 0) {
      const normalized = normalizeFyOpeningBalances(server.balances);
      const snapshot: FyBalanceSnapshot = {
        companyId: cid,
        periodKind: "fy",
        periodKey: priorFyKey,
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

  const local = await readLocalPriorFyOpeningBalances({ companyId: cid, priorFyKey });
  if (local) return local;
  return unavailableOpeningHydrateResult();
}

async function readPriorFyOpeningBalances(params: {
  company: FyPartitionOpeningCompany | null | undefined;
  companyId: string;
  priorFyKey: string;
  beforeMs: number;
  localOnly?: boolean;
}): Promise<LedgerOpeningHydrateResult> {
  const cached = await readLocalPriorFyOpeningBalances({
    companyId: params.companyId,
    priorFyKey: params.priorFyKey,
  });
  if (cached) return cached;
  if (params.localOnly) return unavailableOpeningHydrateResult();
  return hydratePriorFyOpeningBalancesFromServer(params);
}

function collectPartitionOpeningsForBoundaries(params: {
  company: FyPartitionOpeningCompany | null | undefined;
  companyId: string;
  boundaryMsList: number[];
  entityId: string;
  localOnly?: boolean;
}): Promise<FyPartitionOpeningLoadResult> {
  const { company, companyId, boundaryMsList, entityId, localOnly } = params;
  const openingsByBoundaryMs = new Map<number, number>();
  const id = String(entityId || "").trim();
  const cid = String(companyId || "").trim();
  if (!cid || !id || !boundaryMsList.length) {
    return Promise.resolve({ openingsByBoundaryMs, status: "ready" });
  }

  const country = company?.country;
  const unique = [...new Set(boundaryMsList.map((ms) => startOfDay(new Date(ms)).getTime()))].sort(
    (a, b) => a - b
  );

  return (async () => {
    let anyUnavailable = false;

    for (const boundaryMs of unique) {
      const fyKey = getAnusuchi13FyKey(country, new Date(boundaryMs));
      const priorFyKey = priorFyKeyFromRunning(fyKey);
      if (!priorFyKey) continue;
      const fyRange = fiscalYearRangeForKey(country, fyKey);
      const beforeMs = fyRange?.fromMs ?? boundaryMs;
      const hydrate = await readPriorFyOpeningBalances({
        company,
        companyId: cid,
        priorFyKey,
        beforeMs,
        localOnly,
      });
      if (hydrate.status !== "ready") {
        anyUnavailable = true;
        continue;
      }
      const signed = extractEntityBalanceFromFySnapshot(hydrate.balances, id);
      if (signed != null && Number.isFinite(signed)) {
        openingsByBoundaryMs.set(boundaryMs, signed);
      } else {
        anyUnavailable = true;
      }
    }

    if (openingsByBoundaryMs.size > 0) {
      return { openingsByBoundaryMs, status: "ready" };
    }
    if (anyUnavailable) {
      return { openingsByBoundaryMs, status: localOnly ? "ready" : "unavailable" };
    }
    return { openingsByBoundaryMs, status: "ready" };
  })();
}

/** Full voucher mirror: compute each FY boundary opening from SQLite vouchers (no server). */
export async function loadFyPartitionOpeningsFromSqliteMirror(params: {
  company: FyPartitionOpeningCompany | null | undefined;
  companyId: string;
  activeScope?: FyActiveScope | null;
  boundaryMsList: number[];
  entityId: string;
}): Promise<FyPartitionOpeningLoadResult> {
  const { company, companyId, activeScope, boundaryMsList, entityId } = params;
  const openingsByBoundaryMs = new Map<number, number>();
  const id = String(entityId || "").trim();
  const cid = String(companyId || "").trim();
  if (!hasFullLocalLedgerVoucherMirror(company, activeScope ?? null) || !cid || !id) {
    return { openingsByBoundaryMs, status: "unavailable" };
  }

  const country = company?.country;
  const unique = [...new Set(boundaryMsList.map((ms) => startOfDay(new Date(ms)).getTime()))].sort(
    (a, b) => a - b
  );

  for (const boundaryMs of unique) {
    const fyKey = getAnusuchi13FyKey(country, new Date(boundaryMs));
    const fyRange = fiscalYearRangeForKey(country, fyKey);
    const beforeMs = fyRange?.fromMs ?? boundaryMs;
    const balances = await computeEntityClosingBalancesBeforeMs(cid, beforeMs);
    const signed = extractEntityBalanceFromFySnapshot(balances, id);
    if (signed != null && Number.isFinite(signed)) {
      openingsByBoundaryMs.set(boundaryMs, signed);
    }
  }

  return {
    openingsByBoundaryMs,
    status: openingsByBoundaryMs.size > 0 ? "ready" : "unavailable",
  };
}

/** Instant paint from SQLite fy_balance_snapshots — no network. */
export async function loadFyPartitionOpeningsFromLocalCache(
  params: Omit<Parameters<typeof loadFyPartitionOpeningsForEntity>[0], never>
): Promise<FyPartitionOpeningLoadResult> {
  return collectPartitionOpeningsForBoundaries({ ...params, localOnly: true });
}

/**
 * Multi-FY merge dividers: each boundary opening = prior FY closing snapshot (not in-memory running sum).
 * Uses SQLite cache first; network when cache miss.
 */
export async function loadFyPartitionOpeningsForEntity(params: {
  company: FyPartitionOpeningCompany | null | undefined;
  companyId: string;
  boundaryMsList: number[];
  entityId: string;
}): Promise<FyPartitionOpeningLoadResult> {
  return collectPartitionOpeningsForBoundaries(params);
}
