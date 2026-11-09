"use client";

import { collection, getDocsFromServer, query, where } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import { auth, firestore, ensureEmbeddedFirestoreOnlineForCloudCompanyLoad } from "@/lib/firebase";
import { isLocalOnlyMode } from "@/lib/localMode";
import { ensureFreshIdToken } from "@/lib/ensureFreshIdToken";
import {
  sharedCompanyQueryKey,
  sharedCompanyQuerySpecs,
  type SharedCompanyQuerySpec,
} from "@/lib/sharedWithEmailsQuery";

function isPermissionDenied(e: unknown): boolean {
  const code =
    typeof e === "object" && e !== null && "code" in e ? String((e as { code?: unknown }).code || "") : "";
  return code === "permission-denied" || code === "PERMISSION_DENIED";
}

async function pullSharedVariant(
  spec: SharedCompanyQuerySpec,
  preferServer: boolean
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const q = query(collection(firestore, "companies"), where(spec.field, "array-contains", spec.value));
  const mapSnap = (snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) =>
    snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, unknown> }));

  if (preferServer && typeof navigator !== "undefined" && navigator.onLine !== false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, attempt === 1 ? 800 : 2000));
          try {
            await ensureFreshIdToken({ force: true, permissionDenied: true, source: "sharedPull.variantRetry" });
          } catch {
            /* auth race after storage clean */
          }
        }
        const snap = await getDocsFromServer(q);
        if (snap.docs.length > 0 || attempt >= 2) return mapSnap(snap);
      } catch (e) {
        if (isPermissionDenied(e) && attempt < 2) continue;
        if (!isPermissionDenied(e)) {
          console.warn("[sharedCompaniesFirestorePull] server pull failed", sharedCompanyQueryKey(spec), e);
        }
        try {
          return mapSnap(await getDocs(q));
        } catch (e2) {
          if (!isPermissionDenied(e2)) {
            console.warn("[sharedCompaniesFirestorePull] cache pull failed", sharedCompanyQueryKey(spec), e2);
          }
          return [];
        }
      }
    }
    return [];
  }

  try {
    return mapSnap(await getDocs(q));
  } catch (e) {
    if (!isPermissionDenied(e)) {
      console.warn("[sharedCompaniesFirestorePull] pull failed", sharedCompanyQueryKey(spec), e);
    }
    return [];
  }
}

/**
 * Embedded (EXE/APK): shared companies — har query variant alag try (lower + legacy email).
 * Ek variant permission-denied ho to baaki chalte rahen; localhost web jaisa poora union.
 */
export async function pullSharedOnlineCompaniesFromFirestore(
  userEmail: string | null | undefined
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  /**
   * With a server session the shared-company list comes from `pl_companies` (owner + member rows,
   * see `pullPocketBaseCompanyRegistry`). Firestore only holds the historical Firebase list.
   */
  if (getValidPocketBaseAuth()) return [];
  const email =
    String(userEmail || "").trim() ||
    String(auth.currentUser?.email || "").trim();
  const specs = sharedCompanyQuerySpecs(email);
  if (!specs.length) return [];

  if (isLocalOnlyMode()) {
    await ensureEmbeddedFirestoreOnlineForCloudCompanyLoad();
    try {
      await ensureFreshIdToken({ force: true, source: "sharedPull.start" });
    } catch {
      /* auth token race — pull still try karega */
    }
  }

  const preferServer = isLocalOnlyMode();
  const byId = new Map<string, { id: string; data: Record<string, unknown> }>();
  for (const spec of specs) {
    try {
      for (const row of await pullSharedVariant(spec, preferServer)) {
        if (row.data.isDeleted === true || row.data.movedToAdminRecycleAt != null) continue;
        byId.set(row.id, row);
      }
    } catch (e) {
      if (!isPermissionDenied(e)) {
        console.warn("[sharedCompaniesFirestorePull] variant failed", sharedCompanyQueryKey(spec), e);
      }
    }
  }
  return Array.from(byId.values());
}
