"use client";

/**
 * Company recycle-bin root — web / EXE / APK, local + PL-server + online.
 *
 * Local / PL-server companies: SQLite only (Firebase companies/{id} mat chhedo —
 * same id online doc ho to soft-delete/restore cloud production ko corrupt kar deta hai).
 * Online (Firestore) companies: root `companies/{id}` soft markers + optional SQLite mirror.
 * PocketBase companies: root soft markers are written through the PB-aware write path (server copy),
 * with a direct PB root write as fallback; they are never handled as local.
 */
import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { deleteField, doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import {
  getLocalCompanyById,
  upsertLocalCompany,
  type LocalCompanyDoc,
} from "@/lib/localCompanyStore";
import {
  isDeviceLocalCompany,
  isOnlineCompanyRow,
  isPocketBaseSelectorCompanyRow,
  isServerGateCompany,
  type CompanyStorageRow,
} from "@/lib/companyStorageKind";
import { deleteCompanyComplete, restoreCompany } from "@/lib/deleteCompanyFirestoreClient";
import type { Company } from "@/hooks/useCompany";
import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";

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

/**
 * Pocket Ledger Server (PocketBase) company? Same markers the company selector uses
 * (row says pocketbase, or the id is in this device's PB id registry). A PB company is never
 * a "local" company, whatever hint the caller passes: its root doc must be changed on PB.
 */
export function isPocketBaseRecycleCompany(
  cid: string,
  row: CompanyStorageRow | null | undefined
): boolean {
  if (!cid) return false;
  if (row && isServerGateCompany(row)) return false;
  if (row && isPocketBaseSelectorCompanyRow(row)) return true;
  return isPocketBaseCompanyId(cid);
}

/** Company root flags for the recycle bin (same update the online path always used; PB mirrors it). */
function companyRootRecycleSoftDeletePatch(): Record<string, unknown> {
  return {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    movedToAdminRecycleAt: deleteField(),
  };
}

/**
 * PB company root: normal write path first (PB-only in a server session; otherwise root write +
 * PB mirror). If that fails (e.g. no legacy root doc to update), write straight to PB and let a
 * failure surface to the caller.
 */
export async function writePocketBaseCompanyRootPatch(
  cid: string,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    await updateDoc(doc(firestore, "companies", cid), patch);
  } catch {
    const { pbWriteCompanyRoot } = await import("@/lib/pocketbaseData/pbSync");
    await pbWriteCompanyRoot(cid, patch, "update", { throwOnError: true });
  }
}

/** Same PB check, loading the SQLite row (incl. deleted) for the id. */
export async function isPocketBaseRecycleCompanyId(companyId: string): Promise<boolean> {
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  let row: CompanyStorageRow | null = null;
  try {
    row = (await getLocalCompanyById(cid, { includeDeleted: true })) as CompanyStorageRow | null;
  } catch {
    row = null;
  }
  return isPocketBaseRecycleCompany(cid, row);
}

/**
 * Permanent delete of a PocketBase company (recycle bin / delete dialog) -- done on PB, never
 * "local only".
 * - Always: root flag `movedToAdminRecycleAt` (hidden from the owner's bin; Super Admin can still
 *   hard-wipe it on the server).
 * - quickDelete: first wipe the company's records (same routine online companies use; on PB it is a
 *   server soft-delete of every record), and make sure the root is flagged `isDeleted`.
 * The SQLite row is left to the caller (purge or mirror flag).
 */
export async function permanentDeletePocketBaseCompany(
  companyId: string,
  opts: { quickDelete: boolean; userId?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cid = String(companyId || "").trim();
  if (!cid) return { ok: false, error: "Invalid company id" };
  try {
    if (opts.quickDelete) {
      const wiped = await deleteCompanyComplete(cid, String(opts.userId || ""));
      if (!wiped.success) return { ok: false, error: wiped.error || "Permanent delete failed" };
      await writePocketBaseCompanyRootPatch(cid, {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        movedToAdminRecycleAt: serverTimestamp(),
      });
    } else {
      await writePocketBaseCompanyRootPatch(cid, { movedToAdminRecycleAt: serverTimestamp() });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Permanent delete failed" };
  }
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

/** Soft-delete -> recycle bin (Danger Zone / move to bin). */
export async function softDeleteCompanyToRecycleBin(
  companyId: string,
  opts?: { companyStorageSource?: "local" | "online" | string }
): Promise<{ ok: true; root: CompanyRecycleStorageRoot } | { ok: false; error: string }> {
  const { companyId: cid, root, localRow } = await resolveCompanyRecycleRootForId(companyId, opts);
  if (!cid) return { ok: false, error: "Invalid company id" };

  try {
    // PocketBase company: delete on PB (root isDeleted flags), then mirror the flag in SQLite.
    // Never treated as local (even if the caller hint or old row flags say "local").
    const pbCompany = isPocketBaseRecycleCompany(cid, localRow as CompanyStorageRow | null);
    if (pbCompany) {
      await writePocketBaseCompanyRootPatch(cid, companyRootRecycleSoftDeletePatch());
    } else if (!companyRecycleMustSkipFirestore(root)) {
      await updateDoc(doc(firestore, "companies", cid), companyRootRecycleSoftDeletePatch());
    }
    if (localRow) {
      await upsertLocalCompany({
        ...localRow,
        id: cid,
        isDeleted: true,
        deletedAt: Date.now(),
        movedToAdminRecycleAt: null,
      } as LocalCompanyDoc);
    } else if (!pbCompany && companyRecycleMustSkipFirestore(root)) {
      return { ok: false, error: "Local company not found" };
    }
    return { ok: true, root: pbCompany ? "online" : root };
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
    const pbCompany = isPocketBaseRecycleCompany(cid, localRow as CompanyStorageRow | null);
    if (!companyRecycleMustSkipFirestore(root) || pbCompany) {
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
    } else if (!pbCompany && companyRecycleMustSkipFirestore(root)) {
      return { ok: false, error: "Local company not found" };
    }
    return { ok: true, root: pbCompany ? "online" : root };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "restore_failed" };
  }
}
