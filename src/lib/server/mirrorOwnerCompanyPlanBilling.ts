/**
 * Ek owner ki saari `companies` docs par wahi plan / expiry / tier-switch timestamps —
 * billing "Joined date" + `planId` mismatch kam (multi-company account).
 */
import type admin from "@/lib/server/pbAdminTypes";

const FIRESTORE_BATCH_SAFE_OPS = 450;

export type OwnerCompanyPlanPatch = Record<string, unknown>;

/**
 * `ownerId` match docs par `perDocPatch(docId)` apply — primary pehle se update ho chuka ho to `() => ({})` skip.
 */
export async function applyOwnerPlanMirrorBatched(
  db: admin.firestore.Firestore,
  ownerId: string,
  perDocPatch: (companyDocId: string) => OwnerCompanyPlanPatch
): Promise<number> {
  const oid = String(ownerId || "").trim();
  if (!oid) return 0;

  const snap = await db.collection("companies").where("ownerId", "==", oid).get();
  if (snap.empty) return 0;

  let batch = db.batch();
  let opsInBatch = 0;
  let updated = 0;

  for (const d of snap.docs) {
    const patch = perDocPatch(d.id);
    if (!patch || Object.keys(patch).length === 0) continue;
    batch.update(d.ref, patch);
    opsInBatch++;
    updated++;
    if (opsInBatch >= FIRESTORE_BATCH_SAFE_OPS) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();
  return updated;
}
