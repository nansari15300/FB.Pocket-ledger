"use client";

import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { demoteCompanyToLocal } from "@/lib/companyDemote";
import { isDeviceLocalCompany, isStrictLocalOnlyCompany, isServerGateCompany } from "@/lib/companyStorageKind";
import { isProtectedOwnerLocalBackupCompany } from "@/lib/localBackupRestoreCompany";
import { isProtectedDriveLocalRegistryRow } from "@/lib/driveRestoredLocalCompany";
import type { LocalCompanyDoc } from "@/lib/localCompanyStore";
import { listLocalCompanies, removeLocalCompanyById } from "@/lib/localCompanyStore";
import { plDbgCompanyRecovery } from "@/lib/plDebugCompanyRecovery";
import { isCompanyPendingRestoreCloudPush } from "@/lib/restoreCloudBackgroundSync";
import { shouldPreferPlServerOverCloudRow } from "@/lib/companyOnlinePlFlipTrace";

/** Current user company ka owner hai ya nahi (shared vs My companies split). */
export function isCurrentUserOwnerOfCompanyRow(
  row: Pick<LocalCompanyDoc, "ownerId" | "ownerEmail"> | { ownerId?: string; ownerEmail?: string } | null | undefined,
  user: { uid: string; email: string | null }
): boolean {
  if (!row) return false;
  const uid = (user.uid || "").trim();
  const oid = String(row.ownerId || "").trim();
  if (oid && uid && oid === uid) return true;
  const oe = String(row.ownerEmail || "")
    .toLowerCase()
    .trim();
  const ue = String(user.email || "")
    .toLowerCase()
    .trim();
  return !!oe && !!ue && oe === ue;
}

type CompanyShareRow = {
  ownerId?: string;
  ownerEmail?: string;
  sharedWith?: unknown;
  sharedWithEmails?: unknown;
  sharedWithEmailsLower?: unknown;
  driveSharedJoin?: unknown;
};

/** Shared-with-you list: emails (legacy + lower) + sharedWith uid/email entries. */
export function isCurrentUserSharedOnCompanyRow(
  row: CompanyShareRow | null | undefined,
  user: { uid: string; email: string | null }
): boolean {
  if (!row) return false;
  if ((row as { driveSharedJoin?: unknown }).driveSharedJoin === true) return true;
  if (isCurrentUserOwnerOfCompanyRow(row, user)) return false;

  const ue = String(user.email || "")
    .toLowerCase()
    .trim();
  const uid = String(user.uid || "").trim();

  const emailTokens = new Set<string>();
  for (const list of [row.sharedWithEmails, row.sharedWithEmailsLower]) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const t = String(e || "").toLowerCase().trim();
      if (t) emailTokens.add(t);
    }
  }
  if (ue && emailTokens.has(ue)) return true;

  const sharedWith = Array.isArray(row.sharedWith) ? row.sharedWith : [];
  for (const entry of sharedWith) {
    if (!entry || typeof entry !== "object") continue;
    const su = entry as { uid?: string; email?: string };
    if (uid && su.uid && String(su.uid).trim() === uid) return true;
    const se = String(su.email || "").toLowerCase().trim();
    if (ue && se && se === ue) return true;
  }
  return false;
}

/** Header / registry: owner > shared > stored isOwned flag. */
export function resolveCompanyIsOwnedForUser(
  row: (CompanyShareRow & { isOwned?: boolean }) | null | undefined,
  user: { uid: string; email: string | null }
): boolean {
  if (!row) return false;
  if (isCurrentUserOwnerOfCompanyRow(row, user)) return true;
  if (isCurrentUserSharedOnCompanyRow(row, user)) return false;
  return row.isOwned === true;
}

export type ReconcileOnlineMirrorsResult = {
  changed: boolean;
  /** Shared / non-owner rows purged from SQLite (hard delete / no access). */
  removedIds: string[];
  /** Owner online row: permission_denied pe demote — network error pe kuch nahi. */
  demotedIds: string[];
};

/**
 * Company registry ghosts / shared revoke — **`useCompany`** auth mount par periodic `reconcileOnlineMirrorsWithServer`.
 *
 * | Row category | Firestore read | Exists | Missing doc | Catch `permission-denied` | Catch `unavailable` etc. |
 * |--------------|----------------|--------|------------|---------------------------|--------------------------|
 * | Owner + `storageOption: local` pure | _(skip)_ | — | — | — | — |
 * | Drive shared join (`driveSharedJoin`) + local | _(skip)_ | — | — | — | — |
 * | Shared (non-owner) Firestore online | `companies/{id}` | Keep row | **`removeLocalCompanyById`** (ghost) | **Remove** — access revoked | **No-op** (offline; avoid false purge) |
 * | Owner + online mirror | `getDoc` same | Keep | **Remove** — server company hard-deleted | **`demoteCompanyToLocal`** — rules handover/revoke | **No-op** — network flaky |
 *
 * **`removedIds`**: SQLite hard-delete (shared ghost ya owner phantom).
 * **`demotedIds`**: owner-only online row jo demote hue (data preserve, local bucket).
 *
 * Offline-first note: **`unhandled` errors ≠ missing** — silently ignore taaki airplane mode par poori company ud na jaye.
 */
export async function reconcileOnlineMirrorsWithServer(user: {
  uid: string;
  email: string | null;
}): Promise<ReconcileOnlineMirrorsResult> {
  // Airplane / no route: Firestore reads misleading ho sakti hain — registry cleanup sirf tab jab network label online ho (navigator jhoot bol sakta hai lekin APK flight mode me zyatar safe skip).
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { changed: false, removedIds: [], demotedIds: [] };
  }

  const rows = await listLocalCompanies();
  const removedIds: string[] = [];
  const demotedIds: string[] = [];
  let changed = false;

  for (const row of rows) {
    const id = row.id;
    if (isCompanyPendingRestoreCloudPush(id)) continue;
    if (isStrictLocalOnlyCompany(row)) continue;
    // Server-gate mirrored company — sirf SQLite; Firestore root verify mat
    if ((row as { plServerShared?: boolean }).plServerShared === true) continue;
    if (isServerGateCompany(row as never)) continue;
    if (shouldPreferPlServerOverCloudRow(row)) continue;
    const isOwner = isCurrentUserOwnerOfCompanyRow(row, user);
    const storageLocal = String(row.storageOption || "local").toLowerCase() === "local";
    const isDriveSharedJoin = (row as { driveSharedJoin?: unknown }).driveSharedJoin === true;

    // Owner ki device-local / backup-restore company — Firestore verify mat (online ghost purge)
    if (isOwner && (storageLocal || isDeviceLocalCompany(row) || isProtectedOwnerLocalBackupCompany(row, user))) {
      continue;
    }

    // Google Drive shared join — sirf Drive folder + SQLite; Firestore `companies/{id}` nahi
    if (isDriveSharedJoin && storageLocal) {
      continue;
    }

    // Drive restore/join — Firestore root doc verify mat (ghost purge se SQLite mat udao)
    if (isProtectedDriveLocalRegistryRow(row as Record<string, unknown>, user)) {
      continue;
    }

    if (!isOwner) {
      // Shared list: doc missing OR user removed from sharedWith* → local ghost hatao (SQLite stale mat rakho).
      try {
        const snap = await getDoc(doc(firestore, "companies", id));
        if (snap.exists()) {
          const data = snap.data() as CompanyShareRow;
          if (isCurrentUserSharedOnCompanyRow(data, user)) continue;
          await removeLocalCompanyById(id, { firebaseUid: user.uid });
          removedIds.push(id);
          changed = true;
          continue;
        }
        await removeLocalCompanyById(id, { firebaseUid: user.uid });
        removedIds.push(id);
        changed = true;
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === "permission-denied" || code === "PERMISSION_DENIED") {
          await removeLocalCompanyById(id, { firebaseUid: user.uid });
          removedIds.push(id);
          changed = true;
        }
        // unavailable: network — row mat todo
      }
      continue;
    }

    // Owner + online-category row
    try {
      const snap = await getDoc(doc(firestore, "companies", id));
      if (snap.exists()) continue;
      // Doc delete ho chuka hai (Console / admin) → purani demote sirf bucket badalti thi — user ko “local move” glitch; full SQLite wipe
      await removeLocalCompanyById(id, { firebaseUid: user.uid });
      removedIds.push(id);
      changed = true;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "permission-denied" || code === "PERMISSION_DENIED") {
        // Missing doc `getDoc` throw nahi karta — ye deny = doc hai lekin rules me `ownerId` / share match nahi.
        // Chhota retry: auth token race pe galat demote kam ho.
        await new Promise((r) => setTimeout(r, 700));
        try {
          const snapRetry = await getDoc(doc(firestore, "companies", id));
          if (snapRetry.exists()) continue;
          await removeLocalCompanyById(id, { firebaseUid: user.uid });
          removedIds.push(id);
          changed = true;
        } catch (e2: unknown) {
          const c2 = (e2 as { code?: string })?.code;
          if (c2 === "permission-denied" || c2 === "PERMISSION_DENIED") {
            const did = await demoteCompanyToLocal(id, "permission_denied");
            if (did) {
              changed = true;
              demotedIds.push(id);
            }
          }
        }
      }
    }
  }

  plDbgCompanyRecovery("sync1:reconcileOnlineMirrors:done", {
    registryRowsSeen: rows.length,
    removedIds: [...removedIds],
    demotedIds: [...demotedIds],
    changed,
  });

  return { changed, removedIds, demotedIds };
}
