"use client";

import { getDocs } from "firebase/firestore";
import { upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { firestoreVouchersQueryForRange } from "@/lib/ledgerModes/online/fyMonthQueries";
import type { FyDateRangeMs } from "@/lib/fyPagination/types";
import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";

function firestoreValueToPlain(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(firestoreValueToPlain);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = firestoreValueToPlain(v);
    }
    return out;
  }
  return value;
}

/**
 * Fetch one Firestore month/page and mirror vouchers into SQLite.
 */
export async function hydrateOnlineVoucherRangeFromFirestore(params: {
  companyId: string;
  fsCompanyId: string;
  range: FyDateRangeMs;
}): Promise<number> {
  const { companyId, fsCompanyId, range } = params;
  if (!companyId || !fsCompanyId) return 0;
  // Pocket Ledger Server companies: vouchers come from the server pull into the local DB, not Firestore.
  if (isPocketBaseCompanyId(companyId) || isPocketBaseCompanyId(fsCompanyId)) return 0;
  const q = firestoreVouchersQueryForRange(fsCompanyId, range);
  const snap = await getDocs(q);
  let count = 0;
  for (const docSnap of snap.docs) {
    const data = firestoreValueToPlain(docSnap.data()) as Record<string, unknown>;
    if (data.isDeleted === true) continue;
    const ok = await upsertCompanyDocInBrowserDb(companyId, "vouchers", docSnap.id, data, {
      notify: false,
      skipPlanMutationGate: true,
    });
    if (ok) count += 1;
  }
  return count;
}
