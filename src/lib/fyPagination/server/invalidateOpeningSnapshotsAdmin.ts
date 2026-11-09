import type admin from "@/lib/server/pbAdminTypes";

/** Mark server opening snapshots stale so the next read recomputes (no voucher scan here). */
export async function invalidateOpeningSnapshotsAdmin(
  companyRef: admin.firestore.DocumentReference,
  params: { afterMs?: number; invalidateAll?: boolean }
): Promise<number> {
  const { afterMs, invalidateAll } = params;
  const col = companyRef.collection("fySnapshots");
  const now = Date.now();

  let snap: admin.firestore.QuerySnapshot;
  if (invalidateAll) {
    snap = await col.get();
  } else if (Number.isFinite(afterMs) && (afterMs as number) > 0) {
    snap = await col.where("beforeMs", ">", afterMs).get();
  } else {
    return 0;
  }

  if (!snap.size) return 0;

  const db = companyRef.firestore;
  let batch = db.batch();
  let ops = 0;
  let marked = 0;

  for (const doc of snap.docs) {
    batch.set(
      doc.ref,
      {
        stale: true,
        staleAtMs: now,
        computedOnServer: false,
      },
      { merge: true }
    );
    ops++;
    marked++;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  return marked;
}
