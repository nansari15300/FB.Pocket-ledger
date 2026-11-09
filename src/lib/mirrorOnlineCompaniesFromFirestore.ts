"use client";

/**
 * Static/APK/EXE (local-only mode): Firestore owned + shared companies → SQLite mirror.
 * App online-only hai — SQLite sirf offline cache; company docs Firebase par authoritative.
 */

import {
  collection,
  getDocsFromServer,
  query,
  where,
  type Query,
} from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { auth, firestore, ensureEmbeddedFirestoreOnlineForCloudCompanyLoad } from "@/lib/plClientSession";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { FIREBASE_LEDGER_COMPANY_REGISTRY_PULL_EVENT } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import {
  getLocalCompanyById,
  listLocalCompanies,
  localCompanyRowIsDeleted,
  removeLocalCompanyById,
  upsertLocalCompany,
} from "@/lib/localCompanyStore";
import { mergeSharedWithIntoLocalCompanyUsers, parseLocalCompanyUserRows } from "@/lib/localCompanyUsers";
import {
  isCurrentUserOwnerOfCompanyRow,
  isCurrentUserSharedOnCompanyRow,
} from "@/lib/companyOnlineIntegrity";
import { isDeviceLocalCompany, isServerGateCompany, isStrictLocalOnlyCompany } from "@/lib/companyStorageKind";
import { isLocalBackupRestoredCompanyRow } from "@/lib/localBackupRestoreCompany";
import { isProtectedDriveLocalRegistryRow } from "@/lib/driveRestoredLocalCompany";
import { pullSharedOnlineCompaniesFromFirestore } from "@/lib/sharedCompaniesFirestorePull";
import { ownerEmailQueryVariants, sharedCompanyQuerySpecs } from "@/lib/sharedWithEmailsQuery";
import { isListedPlServerSharedCompany } from "@/lib/plServerAccessContext";
import { ensureFreshIdToken } from "@/lib/ensureFreshIdToken";

export type MirrorOnlineUser = {
  uid: string;
  email: string;
};

export type MirroredCompanyRow = {
  id: string;
  data: Record<string, unknown>;
  isOwned: boolean;
};

function companyDocUpdatedAtMs(row: Record<string, unknown>): number {
  const u = row.updatedAt;
  if (u != null && typeof u === "object" && "toMillis" in u && typeof (u as { toMillis?: () => number }).toMillis === "function") {
    try {
      const ms = (u as { toMillis: () => number }).toMillis();
      return typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
    } catch {
      return 0;
    }
  }
  if (typeof u === "number" && Number.isFinite(u)) return u;
  return 0;
}

/** useCompany + mirror — email kabhi sirf customUser / auth.currentUser par ho. */
export function resolveMirrorUserEmail(
  user: { email?: string | null } | null | undefined,
  customUser?: { email?: string | null } | null
): string {
  return (
    String(user?.email || "").trim() ||
    String(customUser?.email || "").trim() ||
    String(auth.currentUser?.email || "").trim()
  );
}

async function ensureAuthReadyForCompanyPull(): Promise<void> {
  if (!isLocalOnlyMode()) return;
  await ensureEmbeddedFirestoreOnlineForCloudCompanyLoad();
  try {
    await ensureFreshIdToken({ force: true, source: "mirror.ensureAuthReady" });
  } catch {
    /* token race — pull phir bhi try */
  }
}

function isPermissionDenied(e: unknown): boolean {
  const code =
    typeof e === "object" && e !== null && "code" in e ? String((e as { code?: unknown }).code || "") : "";
  return code === "permission-denied" || code === "PERMISSION_DENIED";
}

async function pullQuerySnap(q: Query, attempt: number): Promise<{ docs: { id: string; data: () => Record<string, unknown> }[] }> {
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  if (online && isLocalOnlyMode() && attempt === 0) {
    try {
      await ensureFreshIdToken({ force: true, source: "mirror.pullQuerySnap" });
    } catch {
      /* fresh storage clean: auth token race */
    }
  }
  if (online) {
    try {
      const snap = await getDocsFromServer(q);
      if (snap.docs.length > 0 || attempt >= 2) return snap;
      // Server ne 0 docs diye — storage clean par cache khali; cache fallback mat karo, retry loop server dubara try karega.
      if (attempt < 2) return snap;
    } catch (e) {
      if (isPermissionDenied(e) && attempt < 2) {
        try {
          await ensureFreshIdToken({ force: true, permissionDenied: true, source: "mirror.pullQuerySnap.denied" });
        } catch {
          /* retry */
        }
      } else if (process.env.NEXT_PUBLIC_STATIC_BUILD === "1" && !isPermissionDenied(e)) {
        console.warn("[mirrorOnlineCompanies] getDocsFromServer failed", e);
      }
    }
  }
  // Last attempt / offline: local Firestore cache (purane session se) try karo.
  if (attempt >= 2 || !online) {
    try {
      return await getDocs(q);
    } catch {
      return { docs: [] };
    }
  }
  return { docs: [] };
}

async function pullQueryWithRetries(q: Query): Promise<{ docs: { id: string; data: () => Record<string, unknown> }[] }> {
  let snap = await pullQuerySnap(q, 0);
  if (snap.docs.length > 0) return snap;
  await new Promise((r) => setTimeout(r, 700));
  snap = await pullQuerySnap(q, 1);
  if (snap.docs.length > 0) return snap;
  await new Promise((r) => setTimeout(r, 1800));
  return pullQuerySnap(q, 2);
}

async function upsertCloudCompanyDoc(
  id: string,
  docData: Record<string, unknown>
): Promise<void> {
  const rid = String(id || "").trim();
  if (!rid) return;
  const raw = { id: rid, ...docData } as Record<string, unknown>;
  const isCloudDeleted = raw.isDeleted === true;
  const existing = await getLocalCompanyById(rid, { includeDeleted: true });
  if (isStrictLocalOnlyCompany(existing)) return;
  // Same companyId Firestore par bhi maujood ho sakti hai (online company ka backup local pe restore hua,
  // ya wahi company PL server se share ho rahi hai). Aise rows ko dubara `storageOption: firebase` mat banao:
  // LAN/local classification tootti hai → selector bucket + gate filter row ko drop karte hain → clear,
  // phir PL delta / local registry use wapas local bana deti hai → company A↔B flip loop.
  // Attachment mode bhi server↔cloud flip karta hai, isliye host se aise `local:` refs mange jate hain
  // jo us machine par nahi hote (repeat `/__pl_attachment` 404).
  //
  // Staff side: `isServerGateCompany` syncFromCloud:true corruption par false ho jata hai —
  // isliye `plServerShared` flag + live PL share list dono se guard karo (owner restore pe nahi,
  // shared user device pe hi ye race dikhti hai).
  const existingPlShared = (existing as { plServerShared?: unknown } | null)?.plServerShared === true;
  if (
    isServerGateCompany(existing) ||
    existingPlShared ||
    isListedPlServerSharedCompany({ id: rid, plServerHostCompanyId: (existing as { plServerHostCompanyId?: string } | null)?.plServerHostCompanyId }) ||
    (isLocalBackupRestoredCompanyRow(existing as unknown as Record<string, unknown>) &&
      isDeviceLocalCompany(existing))
  ) {
    return;
  }
  // PL / local / Drive role authority — even when same id exists as Online Firebase company.
  try {
    const { companyRolesAuthorityExcludesFirebase } = await import("@/lib/permissionConfigSource");
    if (existing && companyRolesAuthorityExcludesFirebase(existing as any)) {
      return;
    }
  } catch {
    /* optional gate */
  }
  const localMs =
    typeof (existing as unknown as { updatedAt?: unknown })?.updatedAt === "number"
      ? (existing as unknown as { updatedAt: number }).updatedAt
      : 0;
  const cloudMs = companyDocUpdatedAtMs(raw);
  if (existing && localMs > cloudMs) return;

  const firestoreSharedWith = Array.isArray(raw.sharedWith) ? raw.sharedWith : [];
  const prevUsers = existing
    ? parseLocalCompanyUserRows((existing as { localCompanyUsers?: unknown }).localCompanyUsers)
    : [];
  const mergedLocalUsers = mergeSharedWithIntoLocalCompanyUsers(prevUsers, firestoreSharedWith as any);

  const payload = {
    ...(raw as Record<string, unknown>),
    id: rid,
    storageOption: "firebase",
    syncPolicy: "online",
    syncedFromCloud: true,
    localCompanyUsers: mergedLocalUsers,
  };

  if (isCloudDeleted) {
    await upsertLocalCompany({ ...payload, isDeleted: true } as any);
    return;
  }
  await upsertLocalCompany(payload as any);
}

/**
 * Firestore owned + shared → SQLite upsert.
 * UI list seed ke liye `rows` return — SQLite round-trip par mat chhodo.
 */
async function mirrorOnlineCompaniesFromFirestoreImpl(
  user: MirrorOnlineUser,
  ownerIdCandidates: string[]
): Promise<{
  rows: MirroredCompanyRow[];
  ownedIds: Set<string>;
  sharedOnlyIds: Set<string>;
  cloudAllowedIds: Set<string>;
}> {
  /**
   * With a server session the registry comes from `pl_companies` (see `useCompany`), so this
   * Firestore pull must not run: Firebase is authentication only and its `companies` list is
   * historical. Returning empty keeps every local row (nothing is pruned here).
   */
  if (getValidPocketBaseAuth()) {
    return { rows: [], ownedIds: new Set(), sharedOnlyIds: new Set(), cloudAllowedIds: new Set() };
  }
  const ownedIds = new Set<string>();
  const sharedOnlyIds = new Set<string>();
  const byId = new Map<string, MirroredCompanyRow>();

  await ensureAuthReadyForCompanyPull();

  const ownedQueries = ownerIdCandidates
    .filter(Boolean)
    .map((ownerId) => query(collection(firestore, "companies"), where("ownerId", "==", ownerId)));
  const ownedByEmailVariants = ownerEmailQueryVariants(user.email);
  const ownedByEmailQueries = ownedByEmailVariants.map((emailVariant) =>
    query(collection(firestore, "companies"), where("ownerEmail", "==", emailVariant))
  );

  const ownedSnaps = await Promise.all(ownedQueries.map((q) => pullQueryWithRetries(q)));
  const ownedByEmailSnaps =
    ownedByEmailQueries.length > 0
      ? await Promise.all(ownedByEmailQueries.map((q) => pullQueryWithRetries(q)))
      : [{ docs: [] }];

  for (const snap of ownedSnaps) {
    for (const d of snap.docs) ownedIds.add(d.id);
  }
  for (const snap of ownedByEmailSnaps) {
    for (const d of snap.docs) ownedIds.add(d.id);
  }

  // Shared: query variants + dedicated pull (union) — web listener jaisa poora set.
  const sharedSpecs = sharedCompanyQuerySpecs(user.email);
  const sharedSnaps =
    sharedSpecs.length > 0
      ? await Promise.all(
          sharedSpecs.map((spec) =>
            pullQueryWithRetries(
              query(collection(firestore, "companies"), where(spec.field, "array-contains", spec.value))
            )
          )
        )
      : [];

  for (const snap of sharedSnaps) {
    for (const d of snap.docs) {
      if (d.data()?.isDeleted === true || d.data()?.movedToAdminRecycleAt != null) continue;
      if (!ownedIds.has(d.id)) sharedOnlyIds.add(d.id);
      byId.set(d.id, { id: d.id, data: (d.data() ?? {}) as Record<string, unknown>, isOwned: false });
    }
  }

  try {
    const pulledShared = await pullSharedOnlineCompaniesFromFirestore(user.email);
    for (const row of pulledShared) {
      if (!row.id) continue;
      if (!ownedIds.has(row.id)) sharedOnlyIds.add(row.id);
      byId.set(row.id, { id: row.id, data: row.data, isOwned: false });
    }
  } catch (e) {
    console.warn("[mirrorOnlineCompanies] dedicated shared pull failed", e);
  }

  for (const snap of ownedSnaps) {
    for (const d of snap.docs) {
      const data = (d.data() ?? {}) as Record<string, unknown>;
      if (data.isDeleted === true || data.movedToAdminRecycleAt != null) continue;
      byId.set(d.id, { id: d.id, data, isOwned: true });
    }
  }
  for (const snap of ownedByEmailSnaps) {
    for (const d of snap.docs) {
      const data = (d.data() ?? {}) as Record<string, unknown>;
      if (data.isDeleted === true || data.movedToAdminRecycleAt != null) continue;
      byId.set(d.id, { id: d.id, data, isOwned: true });
    }
  }

  const cloudAllowedIds = new Set(byId.keys());
  for (const row of byId.values()) {
    await upsertCloudCompanyDoc(row.id, row.data);
  }

  if (process.env.NEXT_PUBLIC_STATIC_BUILD === "1" && sharedOnlyIds.size === 0 && ownedIds.size > 0) {
    console.warn("[mirrorOnlineCompanies] zero shared companies mirrored", {
      email: user.email,
      ownedCount: ownedIds.size,
    });
  } else if (sharedOnlyIds.size > 0) {
    console.info("[mirrorOnlineCompanies] shared mirrored", {
      sharedCount: sharedOnlyIds.size,
      ownedCount: ownedIds.size,
    });
  }

  return {
    rows: Array.from(byId.values()),
    ownedIds,
    sharedOnlyIds,
    cloudAllowedIds,
  };
}

export async function mirrorOnlineCompaniesFromFirestore(
  user: MirrorOnlineUser,
  ownerIdCandidates: string[]
): Promise<{
  rows: MirroredCompanyRow[];
  ownedIds: Set<string>;
  sharedOnlyIds: Set<string>;
  cloudAllowedIds: Set<string>;
}> {
  if (isFirebaseLedgerDataSyncDisabled()) {
    return {
      rows: [],
      ownedIds: new Set(),
      sharedOnlyIds: new Set(),
      cloudAllowedIds: new Set(),
    };
  }
  return mirrorOnlineCompaniesFromFirestoreImpl(user, ownerIdCandidates);
}

/** Cloud sync ON — sirf company registry list Firestore se (ledger/attachments alag tick se). */
export async function pullOnlineCompanyRegistryFromFirestore(
  user: MirrorOnlineUser,
  ownerIdCandidates: string[]
): Promise<{
  rows: MirroredCompanyRow[];
  ownedIds: Set<string>;
  sharedOnlyIds: Set<string>;
  cloudAllowedIds: Set<string>;
}> {
  return mirrorOnlineCompaniesFromFirestoreImpl(user, ownerIdCandidates);
}

export function requestOnlineCompanyRegistryPull(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(FIREBASE_LEDGER_COMPANY_REGISTRY_PULL_EVENT));
  } catch {
    /* ignore */
  }
}

/** Ghost SQLite rows hatao — shared mirror partial ho to shared rows mat udao. */
export async function purgeGhostOnlineCompanyDeltas(
  user: MirrorOnlineUser,
  cloudAllowedIds: Set<string>
): Promise<void> {
  if (!cloudAllowedIds.size) return;
  const locals = await listLocalCompanies({ includeDeleted: true });
  for (const row of locals) {
    const id = row.id;
    if (!id || cloudAllowedIds.has(id)) continue;
    const isOwner = isCurrentUserOwnerOfCompanyRow(row, user);
    const isSharedMirror =
      !isOwner && isCurrentUserSharedOnCompanyRow(row, user);
    const isPureLocalRow = isDeviceLocalCompany(row);
    const isStrictLocalOnlyRow = isStrictLocalOnlyCompany(row);
    const isDriveSharedJoin = (row as { driveSharedJoin?: unknown }).driveSharedJoin === true;
    if (isStrictLocalOnlyRow) continue;
    if (isOwner && isPureLocalRow) continue;
    if (isDriveSharedJoin) continue;
    if (isProtectedDriveLocalRegistryRow(row as Record<string, unknown>, user)) continue;
    if (isPureLocalRow || isLocalBackupRestoredCompanyRow(row as Record<string, unknown>)) continue;
    if (isSharedMirror) continue;
    if (localCompanyRowIsDeleted(row)) continue;
    await removeLocalCompanyById(id, { firebaseUid: user.uid });
  }
}
