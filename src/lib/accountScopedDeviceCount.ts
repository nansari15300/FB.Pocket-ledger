"use client";

import { collection, collectionGroup, query, where } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";
import { getOrCreateDeviceId } from "@/lib/deviceLimitClient";

type RegistryRow = {
  ownerId?: string | null;
  storageOption?: string | null;
  syncedFromCloud?: boolean;
  authoritativeCompanyId?: string | null;
};

/** Unique physical device ids for one Firebase user (account-wide device plan slots). */
export async function countAccountScopedDevicesForUser(params: {
  firebaseUid: string;
  ownedFirestoreCompanyIds: string[];
  registryRows?: RegistryRow[];
  /** When viewer is the owner, count this browser's local-company slot too. */
  viewerUid?: string | null;
}): Promise<number> {
  const uid = String(params.firebaseUid || "").trim();
  if (!uid) return 0;
  const unique = new Set<string>();

  try {
    const cg = await getDocs(
      query(collectionGroup(firestore, "devices"), where("userId", "==", uid))
    );
    for (const d of cg.docs) unique.add(d.id);
  } catch {
    /* per-company fallback */
  }

  for (const fsId of params.ownedFirestoreCompanyIds) {
    const cid = String(fsId || "").trim();
    if (!cid) continue;
    try {
      const snap = await getDocs(collection(firestore, "companies", cid, "devices"));
      for (const d of snap.docs) {
        if (String(d.data().userId || "").trim() === uid) unique.add(d.id);
      }
    } catch {
      /* skip unreadable company */
    }
  }

  const viewer = String(params.viewerUid || "").trim();
  if (viewer && viewer === uid) {
    let hasLocalOwned = false;
    for (const row of params.registryRows ?? []) {
      if (String(row.ownerId || "").trim() !== uid) continue;
      if (!isCloudLinkedCompanyStorage(row)) {
        hasLocalOwned = true;
        break;
      }
    }
    if (hasLocalOwned) {
      const did = getOrCreateDeviceId();
      if (did) unique.add(did);
    }
  }

  return unique.size;
}
