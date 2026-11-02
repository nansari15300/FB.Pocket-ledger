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
  removeLocalCompanyById,
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
import { restoreCompany } from "@/lib/deleteCompanyFirestoreClient";
import type { Company } from "@/hooks/useCompany";
import {
  isPocketBaseCompanyId,
  markPocketBaseCompanyPruned,
  unregisterPocketBaseCompanyId,
} from "@/lib/pocketbaseData/pbCompanyRegistry";
import { pbRequest } from "@/lib/pocketbaseData/pbClient";

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

/** Per-company "Delete mode" (set by the server admin): hard = permanent at once, soft = hidden, admin wipes later. */
export type PbDeleteMode = "soft" | "hard";

/** 'Demo Company' is never hard-deleted (the server enforces the same rule). */
export function isDemoCompanyName(name: unknown): boolean {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase() === "demo company";
}

/**
 * Delete mode of a PocketBase company, read from the server (`POST /api/pl/company/delete-mode`).
 * Soft when: Demo Company, the server has no such setting yet (older server), or the lookup fails --
 * Soft is the safe direction (the company is only hidden, nothing is wiped).
 */
export async function getPocketBaseCompanyDeleteMode(
  companyId: string,
  companyName?: string | null
): Promise<{ mode: PbDeleteMode; demo: boolean; known: boolean }> {
  const cid = String(companyId || "").trim();
  let name = companyName ?? null;
  if (name == null && cid) {
    try {
      const row = await getLocalCompanyById(cid, { includeDeleted: true });
      name = (row as { name?: string } | null)?.name ?? null;
    } catch {
      name = null;
    }
  }
  if (isDemoCompanyName(name)) return { mode: "soft", demo: true, known: true };
  if (!cid) return { mode: "soft", demo: false, known: false };
  try {
    const res = (await pbRequest("/api/pl/company/delete-mode", {
      method: "POST",
      body: { company: cid },
      timeoutMs: 15_000,
    })) as { mode?: string; demo?: boolean } | null;
    if (res && res.demo === true) return { mode: "soft", demo: true, known: true };
    return { mode: res && res.mode === "hard" ? "hard" : "soft", demo: false, known: true };
  } catch {
    return { mode: "soft", demo: false, known: false };
  }
}

/**
 * Permanent delete of a PocketBase company (recycle bin / delete dialog) -- done on PB, never
 * "local only". It follows the company's Delete mode (set by the server admin):
 * - Hard: the owner's request `POST /api/pl/company/hard-delete` removes every record, file and the
 *   company itself on the server at once. 'Demo Company' is never hard-deleted. The device's local
 *   copy is removed afterwards.
 * - Soft (default): root flag `movedToAdminRecycleAt` (hidden from the owner's bin; the Super Admin can
 *   still hard-wipe it on the server); with quickDelete the root is also flagged `isDeleted`.
 *   No Firebase / Firestore cleanup runs for PocketBase companies any more.
 * In Soft mode the SQLite row is left to the caller (purge or mirror flag).
 */
export async function permanentDeletePocketBaseCompany(
  companyId: string,
  opts: { quickDelete: boolean; userId?: string | null; companyName?: string | null }
): Promise<{ ok: true; mode: PbDeleteMode } | { ok: false; error: string }> {
  const cid = String(companyId || "").trim();
  if (!cid) return { ok: false, error: "Invalid company id" };
  try {
    const info = await getPocketBaseCompanyDeleteMode(cid, opts.companyName);
    if (info.mode === "hard" && !info.demo) {
      await pbRequest("/api/pl/company/hard-delete", {
        method: "POST",
        body: { company: cid },
        timeoutMs: 180_000,
      });
      try {
        markPocketBaseCompanyPruned(cid);
        unregisterPocketBaseCompanyId(cid);
        await removeLocalCompanyById(cid);
      } catch {
        /* local copy clean-up is best effort */
      }
      return { ok: true, mode: "hard" };
    }
    if (opts.quickDelete) {
      await writePocketBaseCompanyRootPatch(cid, {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        movedToAdminRecycleAt: serverTimestamp(),
      });
    } else {
      await writePocketBaseCompanyRootPatch(cid, { movedToAdminRecycleAt: serverTimestamp() });
    }
    return { ok: true, mode: "soft" };
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
