"use client";

import { endOfDay, startOfDay } from "date-fns";
import { collection, doc } from "@/lib/pbCompat/firestore";
import { getDocs, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { buildCopyLedgerComparison, reconciliationCollectionToLedgerContext } from "@/lib/copyLedgerCrossCompany";
import { getCompanyDocFromBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { isLocalOnlyMode } from "@/lib/localMode";
import type { ReconciliationLedgerRow, ReconciliationShareScope } from "@/lib/reconciliation/types";

/** Voucher date → ISO string for snapshot storage. */
function rawDateToIso(raw: unknown): string {
  if (!raw) return "";
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "object" && raw !== null && "toDate" in (raw as Record<string, unknown>)) {
    try {
      const d = (raw as { toDate?: () => Date }).toDate?.();
      return d instanceof Date ? d.toISOString() : "";
    } catch {
      return "";
    }
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}

/** ISO date row share / client filter ke andar hai ya nahi. */
export function isRowInDateRange(iso: string, from?: Date | null, to?: Date | null): boolean {
  if (!iso) return false;
  const t = new Date(iso);
  if (isNaN(t.getTime())) return false;
  if (from && t < startOfDay(from)) return false;
  if (to && t > endOfDay(to)) return false;
  return true;
}

function inShareDateRange(iso: string, scope: ReconciliationShareScope, from?: string | null, to?: string | null): boolean {
  if (scope !== "date_range") return true;
  const fromD = from ? new Date(from) : null;
  const toD = to ? new Date(to) : null;
  return isRowInDateRange(iso, fromD, toD);
}

/** Share doc me stored date range → UI label / read-only display. */
export function shareDocDateRange(share: {
  shareScope: ReconciliationShareScope;
  dateFrom?: string | null;
  dateTo?: string | null;
}): { from?: Date; to?: Date } | undefined {
  if (share.shareScope !== "date_range") return undefined;
  const from = share.dateFrom ? startOfDay(new Date(share.dateFrom)) : undefined;
  const to = share.dateTo ? endOfDay(new Date(share.dateTo)) : undefined;
  if ((!from || isNaN(from.getTime())) && (!to || isNaN(to.getTime()))) return undefined;
  return { from: from && !isNaN(from.getTime()) ? from : undefined, to: to && !isNaN(to.getTime()) ? to : undefined };
}

/** You-side client date filter — period opening + running balance dubara. */
export function applyClientDateRangeFilter(
  allRows: ReconciliationLedgerRow[],
  baseOpening: number,
  range?: { from?: Date; to?: Date }
): { rows: ReconciliationLedgerRow[]; openingBalance: number } {
  if (!range?.from && !range?.to) {
    return { rows: allRows, openingBalance: baseOpening };
  }
  let opening = baseOpening;
  const inRange: ReconciliationLedgerRow[] = [];
  for (const r of allRows) {
    if (!r.rawDate) continue;
    const d = new Date(r.rawDate);
    if (isNaN(d.getTime())) continue;
    if (range.from && d < startOfDay(range.from)) {
      opening += (r.debit || 0) - (r.credit || 0);
      continue;
    }
    if (range.to && d > endOfDay(range.to)) continue;
    inRange.push(r);
  }
  return { rows: withRunningBalances(inRange, opening), openingBalance: opening };
}

/** Snapshot rows se opening infer — share doc me `*OpeningBalance` 0/missing ho par baked balance se. */
export function inferOpeningBalanceFromLedgerRows(rows: ReconciliationLedgerRow[] | undefined): number {
  const list = rows ?? [];
  if (list.length === 0) return 0;
  const sorted = [...list].sort((a, b) => {
    const ta = a.rawDate ? new Date(a.rawDate).getTime() : 0;
    const tb = b.rawDate ? new Date(b.rawDate).getTime() : 0;
    return ta - tb;
  });
  for (const r of sorted) {
    if (r.balance === undefined || r.balance === null) continue;
    const bal = Number(r.balance);
    if (Number.isNaN(bal)) continue;
    const dr = Number(r.debit) || 0;
    const cr = Number(r.credit) || 0;
    // Reverse: bal = opening + dr - cr  =>  opening = bal - dr + cr
    return bal - dr + cr;
  }
  return 0;
}

/** Account doc se opening balance — live ledger / recon opening row. */
export async function loadAccountOpeningBalance(
  companyId: string,
  collectionName: string,
  accountId: string
): Promise<number> {
  if (!companyId || !collectionName || !accountId) return 0;
  try {
    if (isLocalOnlyMode()) {
      const row = await getCompanyDocFromBrowserDb(companyId, collectionName, accountId);
      const localOpening = Number((row as { openingBalance?: unknown })?.openingBalance) || 0;
      if (localOpening !== 0) return localOpening;
      // Static/APK: other party account mirror me nahi — Firestore try (loadCompanyVouchers jaisa)
      try {
        const snap = await getDoc(doc(firestore, `companies/${companyId}/${collectionName}`, accountId));
        if (snap.exists()) {
          return Number(snap.data()?.openingBalance) || 0;
        }
      } catch {
        /* permission / offline — niche 0 */
      }
      return 0;
    }
    const snap = await getDoc(doc(firestore, `companies/${companyId}/${collectionName}`, accountId));
    if (!snap.exists()) return 0;
    return Number(snap.data()?.openingBalance) || 0;
  } catch {
    return 0;
  }
}

/** Opening + har row ke baad running balance (party ledger: +Dr −Cr). */
export function withRunningBalances(
  rows: ReconciliationLedgerRow[],
  openingBalance: number
): ReconciliationLedgerRow[] {
  let bal = openingBalance;
  return rows.map((r) => {
    bal += (r.debit || 0) - (r.credit || 0);
    return { ...r, balance: bal };
  });
}

/** Active vouchers — recycle bin / soft-delete skip. */
function filterActiveVouchers(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.filter((v) => v.isDeleted !== true && (v.deletedAt == null || v.deletedAt === ""));
}

/** Voucher docs merge — Firestore + SQLite (local pending); id pe live/local overwrite. */
function mergeVoucherDocsById(
  primary: Array<Record<string, unknown>>,
  secondary: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const v of primary) {
    const id = String(v.id || "").trim();
    if (id) byId.set(id, v);
  }
  for (const v of secondary) {
    const id = String(v.id || "").trim();
    if (id) byId.set(id, v);
  }
  return Array.from(byId.values());
}

/** Company ke vouchers load — recon cross-company: Firestore pehle (dusri company ka SQLite cache adhoora ho sakta hai). */
export async function loadCompanyVouchers(companyId: string): Promise<Array<Record<string, unknown>>> {
  if (!companyId) return [];
  let serverRows: Array<Record<string, unknown>> = [];

  // Local/static me bhi remote side ke liye Firestore try — sirf selected company mirror kaafi nahi
  try {
    const snap = await getDocs(collection(firestore, `companies/${companyId}/vouchers`));
    serverRows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, unknown>>;
  } catch {
    serverRows = [];
  }

  if (isLocalOnlyMode()) {
    try {
      const localRows = (await listCompanyDocsFromBrowserDb(companyId, "vouchers")) as Array<
        Record<string, unknown>
      >;
      serverRows =
        serverRows.length === 0
          ? localRows
          : localRows.length > 0
            ? mergeVoucherDocsById(serverRows, localRows)
            : serverRows;
    } catch {
      /* Firestore / local jo mila wahi */
    }
  }

  return filterActiveVouchers(serverRows);
}

/** Account ke ledger rows snapshot — share / link / recon page ke liye. */
export async function buildReconciliationLedgerSnapshot(params: {
  companyId: string;
  accountId: string;
  collection: string;
  shareScope: ReconciliationShareScope;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<{ rows: ReconciliationLedgerRow[]; openingBalance: number }> {
  const { companyId, accountId, collection: collectionName, shareScope, dateFrom, dateTo } = params;
  const openingBalance = await loadAccountOpeningBalance(companyId, collectionName, accountId);
  const vouchers = await loadCompanyVouchers(companyId);
  const { rows } = buildCopyLedgerComparison({
    vouchers,
    sourcePartyId: accountId,
    targetKnownIds: new Set(),
    ledgerContext: reconciliationCollectionToLedgerContext(collectionName),
  });
  const voucherById = new Map<string, Record<string, unknown>>();
  for (const v of vouchers) {
    const id = String(v.id || "");
    if (id) voucherById.set(id, v);
  }
  const sorted = rows
    .filter((r) => inShareDateRange(rawDateToIso(r.rawDate), shareScope, dateFrom, dateTo))
    .map((r) => {
      const v = voucherById.get(r.id);
      const title =
        v && String(v.type || "") === "note" ? String(v.title || "").trim() : "";
      const crefRaw = v?.crossCopySourceRef as { companyId?: string; voucherId?: string } | undefined;
      const crossCopySourceRef =
        crefRaw?.companyId && crefRaw?.voucherId
          ? { companyId: String(crefRaw.companyId), voucherId: String(crefRaw.voucherId) }
          : undefined;
      return {
        id: r.id,
        voucherNumber: r.voucherNumber,
        type: r.type,
        rawDate: rawDateToIso(r.rawDate),
        dateLabel: r.dateLabel,
        narration: r.narration,
        ...(title ? { title } : {}),
        ...(crossCopySourceRef ? { crossCopySourceRef } : {}),
        debit: r.debit,
        credit: r.credit,
        amount: r.amount,
      };
    })
    .sort((a, b) => {
      const ta = a.rawDate ? new Date(a.rawDate).getTime() : 0;
      const tb = b.rawDate ? new Date(b.rawDate).getTime() : 0;
      return ta - tb;
    });
  return {
    rows: withRunningBalances(sorted, openingBalance),
    openingBalance,
  };
}

/** Live + stored snapshot rows merge — remote side adhoora live load par bhi saari trxns (id union). */
export function mergeReconciliationLedgerRows(
  liveRows: ReconciliationLedgerRow[],
  snapshotRows: ReconciliationLedgerRow[],
  openingBalance: number
): ReconciliationLedgerRow[] {
  const byId = new Map<string, ReconciliationLedgerRow>();
  for (const r of snapshotRows) {
    const id = String(r.id || "").trim();
    if (id) byId.set(id, r);
  }
  for (const r of liveRows) {
    const id = String(r.id || "").trim();
    if (id) byId.set(id, r);
  }
  const merged = Array.from(byId.values()).sort((a, b) => {
    const ta = a.rawDate ? new Date(a.rawDate).getTime() : 0;
    const tb = b.rawDate ? new Date(b.rawDate).getTime() : 0;
    return ta - tb;
  });
  return withRunningBalances(merged, openingBalance);
}

/** Stored snapshot (purane shares) par opening se balance dubara. */
export function rowsWithOpeningFromSnapshot(
  rows: ReconciliationLedgerRow[] | undefined,
  openingBalance: number | undefined
): { rows: ReconciliationLedgerRow[]; openingBalance: number } {
  const base = rows ?? [];
  let opening = openingBalance ?? 0;
  // Purane share: opening field 0 ho par snapshot rows me running balance baked ho
  if (opening === 0) {
    const inferred = inferOpeningBalanceFromLedgerRows(base);
    if (inferred !== 0) opening = inferred;
  }
  const needsBalance = base.some((r) => r.balance === undefined || r.balance === null);
  return {
    rows: needsBalance ? withRunningBalances(base, opening) : base,
    openingBalance: opening,
  };
}
