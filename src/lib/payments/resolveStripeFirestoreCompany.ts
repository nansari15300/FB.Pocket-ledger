/**
 * Stripe checkout metadata me `companyId` local-only ho sakta hai (Firestore doc nahi).
 * Tab `ownerId === userId` se company dhundho — preferred id match ho to wahi, warna sabse recently touched.
 */
import "server-only";
import type admin from "@/lib/server/pbAdminTypes";

function docTimeMs(data: admin.firestore.DocumentData | undefined): number {
  if (!data) return 0;
  const u = data.updatedAt as admin.firestore.Timestamp | undefined;
  const c = data.createdAt as admin.firestore.Timestamp | undefined;
  return (u?.toMillis?.() ?? c?.toMillis?.() ?? 0) || 0;
}

export async function findOwnedCompanyIdForUser(
  db: admin.firestore.Firestore,
  ownerUid: string,
  preferredCompanyId?: string | null
): Promise<string | null> {
  const uid = ownerUid?.trim();
  if (!uid) return null;
  const snap = await db.collection("companies").where("ownerId", "==", uid).limit(40).get();
  if (snap.empty) return null;
  const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const pref = preferredCompanyId?.trim();
  if (pref && rows.some((r) => r.id === pref)) return pref;

  const now = Date.now();
  const activePaid = rows.filter((r) => {
    const ms = typeof r.data.planExpiryMs === "number" ? r.data.planExpiryMs : 0;
    return ms > now;
  });
  if (activePaid.length > 0) {
    activePaid.sort((a, b) => docTimeMs(b.data) - docTimeMs(a.data));
    return activePaid[0].id;
  }

  rows.sort((a, b) => docTimeMs(b.data) - docTimeMs(a.data));
  return rows[0]?.id ?? null;
}
