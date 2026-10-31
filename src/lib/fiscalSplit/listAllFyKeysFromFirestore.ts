"use client";

import {
  collection,
  limit,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { startOfDay } from "date-fns";
import { getAnusuchi13FyKey } from "@/lib/reports/anusuchi13Confirmation";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";

// Smaller pages limit memory and main-thread decode spikes for older companies
// that need a one-time full scan before the FY index cache has been seeded.
const FIRESTORE_FY_SCAN_PAGE = 100;

export type FyKeysFirestoreScanProgress = {
  pages: number;
  vouchersScanned: number;
};

export type FyKeysFirestoreScanResult = {
  fyKeys: string[];
  minDateMs: number | null;
  maxDateMs: number | null;
  vouchersScanned: number;
};

/**
 * Paginated Firestore scan — sirf voucher `date` se distinct FY keys.
 * Full vouchers app memory / useVouchers me load nahi hote.
 */
export async function listAllFyKeysFromFirestore(params: {
  fsCompanyId: string;
  country?: string;
  pageSize?: number;
  onProgress?: (progress: FyKeysFirestoreScanProgress) => void;
}): Promise<FyKeysFirestoreScanResult> {
  const { fsCompanyId, country, pageSize = FIRESTORE_FY_SCAN_PAGE, onProgress } = params;
  if (!fsCompanyId || typeof window === "undefined") {
    return { fyKeys: [], minDateMs: null, maxDateMs: null, vouchersScanned: 0 };
  }

  const fyKeys = new Set<string>();
  let minDateMs: number | null = null;
  let maxDateMs: number | null = null;
  let lastDoc: QueryDocumentSnapshot | null = null;
  let pages = 0;
  let vouchersScanned = 0;

  const col = collection(firestore, `companies/${fsCompanyId}/vouchers`);

  while (true) {
    const q = lastDoc
      ? query(col, orderBy("date", "asc"), startAfter(lastDoc), limit(pageSize))
      : query(col, orderBy("date", "asc"), limit(pageSize));

    const snap = await getDocs(q);
    if (snap.empty) break;

    pages += 1;
    for (const docSnap of snap.docs) {
      vouchersScanned += 1;
      const data = docSnap.data();
      if (data?.isDeleted === true) continue;
      const d = parseFirestoreDateFieldToJsDate(data?.date);
      if (!d) continue;
      const ms = startOfDay(d).getTime();
      minDateMs = minDateMs == null ? ms : Math.min(minDateMs, ms);
      maxDateMs = maxDateMs == null ? ms : Math.max(maxDateMs, ms);
      fyKeys.add(getAnusuchi13FyKey(country, d));
    }

    onProgress?.({ pages, vouchersScanned });
    lastDoc = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.docs.length < pageSize) break;
    // Keep Settings UI responsive during multi-page FY bootstrap scan.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const sorted = [...fyKeys].sort((a, b) => {
    const aStart = Number(a.split("-")[0]) || 0;
    const bStart = Number(b.split("-")[0]) || 0;
    return aStart - bStart;
  });
  return { fyKeys: sorted, minDateMs, maxDateMs, vouchersScanned };
}
