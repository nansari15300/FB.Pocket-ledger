"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { fySnapshotDocPath } from "@/lib/ledgerModes/online/fyMonthQueries";
import type { FyBalanceSnapshot } from "@/lib/fyPagination/types";

/** Write closing snapshot doc for cross-device opening parity. */
export async function syncFyBalanceSnapshotToFirestore(
  fsCompanyId: string,
  snapshot: FyBalanceSnapshot
): Promise<void> {
  if (!fsCompanyId || !snapshot.periodKey) return;
  const path = fySnapshotDocPath(fsCompanyId, snapshot.periodKind, snapshot.periodKey);
  const ref = doc(firestore, path);
  await setDoc(
    ref,
    {
      periodKind: snapshot.periodKind,
      periodKey: snapshot.periodKey,
      closingAtMs: snapshot.closingAtMs,
      balances: snapshot.balances,
      updatedAtMs: snapshot.updatedAtMs,
    },
    { merge: true }
  );
}
