"use client";

/**
 * Company recycle-bin root — web / EXE / APK, local + PL-server + online.
 *
 * Local / PL-server companies: SQLite only (Firebase companies/{id} mat chhedo —
 * same id online doc ho to soft-delete/restore cloud production ko corrupt kar deta hai).
 * Online (Firestore) companies: root `companies/{id}` soft markers + optional SQLite mirror.
 */
import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { deleteField, doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import {
  getLocalCompanyById,
  promoteLocalCompanyRowToOnline,
  upsertLocalCompany,
  type LocalCompanyDoc,
} from "@/lib/localCompanyStore";
import {
  isDeviceLocalCompany,
  isOnlineCompanyRow,
  isServerGateCompany,
  type CompanyStorageRow,
} from "@/lib/companyStorageKind";
import { restoreCompany } from "@/lib/deleteCompanyFirestoreClient";
import type { Company } from "@/hooks/useCompany";

export type CompanyRecycleStorageRoot = "local" | "pl_server" | "online";

export function resolveCompanyRecycleStorageRoot(
  row: (CompanyStorageRow & { companyStorageSource?: string }) | null | undefined
): CompanyRecycleStorageRoot {
  if (!row) return "online";
  const hint = String((row as { companyStorageSource?: string }).companyStorageSource || "")
    .toLowerCase()
    .trim();
  if (hint === "local") return "local";
  if (hint === "online") return "online";
  if (isServerGateCompany(row)) return "pl_server";
  if (isDeviceLocalCompany(row)) return "local";
  try {
    if (isOnlineCompanyRow(row as Company)) return "online";
  } catch {
    /* row may lack full Company shape */
  }
  const so = String(row.storageOption || "").toLowerCase().trim();
  if (so === "firebase" || so === "drive") return "online";
  if (so === "local") return "local";
  if (row.syncedFromCloud === true) return "online";
  return "local";
}

/** True → never write/delete Firestore `companies/{id}` for this recycle action. */
export function companyRecycleMustSkipFirestore(root: CompanyRecycleStorageRoot): boolean {
  return root === "local" || root === "pl_server";
}

export async function resolveCompanyRecycleRootForId(
  companyId: string,
  hint?: { companyStorageSource?: "local" | "online" | string } | null
): Promise<{
  companyId: string;
  root: CompanyRecycleStorageRoot;
  localRow: LocalCompanyDoc | null;
}> {
  const cid = String(companyId || "").trim();
  const localRow = cid ? await getLocalCompanyById(cid, { includeDeleted: true }) : null;
  if (hint?.companyStorageSource === "local") {
    return { companyId: cid, root: "local", localRow };
  }
  if (hint?.companyStorageSource === "online") {
    return { companyId: cid, root: "online", localRow };
  }
  const row = (localRow || hint || null) as CompanyStorageRow | null;
  return { companyId: cid, root: resolveCompanyRecycleStorageRoot(row), localRow };
}

/** Soft-delete → recycle bin (Danger Zone / move to bin). */
export async function softDeleteCompanyToRecycleBin(
  companyId: string,
  opts?: { companyStorageSource?: "local" | "online" | string }
): Promise<
  | { ok: true; root: CompanyRecycleStorageRoot; releasedToOnline?: boolean }
  | { ok: false; error: string }
> {
  const { companyId: cid, root, localRow } = await resolveCompanyRecycleRootForId(companyId, opts);
  if (!cid) return { ok: false, error: "Invalid company id" };

  try {
    // Local tab me stuck Firebase company: SQLite soft-delete + strict-local guard
    // remirror skip karta hai → Online me kabhi nahi aati / delete "fail" feel.
    // Live Firestore twin ho to Local stamp clear karke Online tab pe release karo.
    if (root === "local") {
      let cloudData: Record<string, unknown> | null = null;
      try {
        const snap = await getDoc(doc(firestore, "companies", cid));
        if (snap.exists()) {
          const data = (snap.data() || {}) as Record<string, unknown>;
          if (data.isDeleted !== true && data.movedToAdminRecycleAt == null) {
            cloudData = data;
          }
        }
      } catch {
        cloudData = null;
      }
      if (cloudData) {
        const promoted = await promoteLocalCompanyRowToOnline(cid, {
          ...(localRow || {}),
          ...cloudData,
          id: cid,
          name: String(cloudData.name || localRow?.name || cid),
          ownerId: String(cloudData.ownerId || localRow?.ownerId || ""),
          ownerEmail:
            (cloudData.ownerEmail as string | null | undefined) ??
            (localRow?.ownerEmail ?? null),
          syncedFromCloud: true,
          isDeleted: false,
          deletedAt: null,
          movedToAdminRecycleAt: null,
        } as Partial<LocalCompanyDoc>);
        if (!promoted) {
          // No SQLite row yet — write online shape so selector can show Online tab.
          await upsertLocalCompany({
            ...(cloudData as LocalCompanyDoc),
            id: cid,
            name: String(cloudData.name || cid),
            ownerId: String(cloudData.ownerId || ""),
            ownerEmail: (cloudData.ownerEmail as string | null | undefined) ?? null,
            storageOption: "firebase",
            syncPolicy: "online",
            syncedFromCloud: true,
            authoritativeCompanyId: cid,
            localOnly: false,
            firestoreSyncDisabled: false,
            isDeleted: false,
            deletedAt: null,
            movedToAdminRecycleAt: null,
          } as LocalCompanyDoc);
        }
        return { ok: true, root: "online", releasedToOnline: true };
      }
    }

    if (!companyRecycleMustSkipFirestore(root)) {
      await updateDoc(doc(firestore, "companies", cid), {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        movedToAdminRecycleAt: deleteField(),
      });
    }
    if (localRow) {
      await upsertLocalCompany({
        ...localRow,
        id: cid,
        isDeleted: true,
        deletedAt: Date.now(),
        movedToAdminRecycleAt: null,
      } as LocalCompanyDoc);
    } else if (companyRecycleMustSkipFirestore(root)) {
      return { ok: false, error: "Local company not found" };
    }
    return { ok: true, root };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "soft_delete_failed" };
  }
}

/**
 * Restore company from recycle bin → production list.
 * Online: root Firestore doc. Local / PL: SQLite only.
 */
export async function restoreCompanyFromRecycleBin(
  companyId: string,
  opts?: { companyStorageSource?: "local" | "online" | string }
): Promise<{ ok: true; root: CompanyRecycleStorageRoot } | { ok: false; error: string }> {
  const { companyId: cid, root, localRow } = await resolveCompanyRecycleRootForId(companyId, opts);
  if (!cid) return { ok: false, error: "Invalid company id" };

  try {
    if (!companyRecycleMustSkipFirestore(root)) {
      const result = await restoreCompany(cid);
      if (!result.success) {
        return { ok: false, error: result.error || "Firestore restore failed" };
      }
    }
    if (localRow) {
      await upsertLocalCompany({
        ...localRow,
        id: cid,
        isDeleted: false,
        deletedAt: null,
        movedToAdminRecycleAt: null,
      } as LocalCompanyDoc);
    } else if (companyRecycleMustSkipFirestore(root)) {
      return { ok: false, error: "Local company not found" };
    }
    return { ok: true, root };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "restore_failed" };
  }
}
