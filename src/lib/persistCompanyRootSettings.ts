"use client";

import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { updateCompanyDocRoot } from "@/lib/companyDocsClient";
import {
  companyRowUsesSqliteLedgerWrites,
  isPureLocalLedgerCompany,
  isServerGateCompany,
} from "@/lib/companyStorageKind";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import {
  notifyPlServerHostCompanyMetaSaved,
  PL_SERVER_COMPANY_META_UPDATED_EVENT,
  shouldPersistPermissionConfigViaPlServerHost,
} from "@/lib/plServerCompanyMetaSync";

type CompanyLike = {
  id?: string;
  storageOption?: string | null;
  syncedFromCloud?: boolean;
  syncPolicy?: string | null;
  plServerShared?: boolean;
  authoritativeCompanyId?: string;
} | null | undefined;

/** Local / PL / SQLite ledger company — Firestore `companies/{id}` mat likho. */
export function companyRootSettingsUseLocalStore(company: CompanyLike): boolean {
  if (!company) return false;
  if (isServerGateCompany(company)) return true;
  if (isPureLocalLedgerCompany(company)) return true;
  if (companyRowUsesSqliteLedgerWrites(company)) return true;
  if (isOfflineCompanyStorage(company)) return true;
  return false;
}

export type PersistCompanyRootSettingsResult = "local" | "firestore";

/**
 * Company root settings (voucher / decimal / display / profile fields).
 * Local + PL host → SQLite (+ meta bump). Online → Firestore (+ optional SQLite mirror).
 */
export async function persistCompanyRootSettingsPatch(opts: {
  companyId: string;
  company: CompanyLike;
  patch: Record<string, unknown>;
  reloadLocalCompanyRegistry?: () => void;
  triggerSync?: () => void;
}): Promise<PersistCompanyRootSettingsResult> {
  const companyId = String(opts.companyId || "").trim();
  if (!companyId) throw new Error("Missing company id");
  const patch = opts.patch && typeof opts.patch === "object" ? opts.patch : {};

  const preferLocal =
    companyRootSettingsUseLocalStore(opts.company) ||
    (await shouldPersistPermissionConfigViaPlServerHost(companyId, opts.company));

  if (preferLocal) {
    const row = await getLocalCompanyById(companyId, { includeDeleted: true });
    if (!row) throw new Error("Local company row not found");
    await upsertLocalCompany({
      ...row,
      ...patch,
      id: companyId,
      updatedAt: Date.now(),
    } as LocalCompanyDoc);
    void updateCompanyDocRoot(companyId, patch);
    opts.reloadLocalCompanyRegistry?.();
    opts.triggerSync?.();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(PL_SERVER_COMPANY_META_UPDATED_EVENT, { detail: { companyId } })
      );
    }
    void notifyPlServerHostCompanyMetaSaved(companyId, patch);
    return "local";
  }

  await updateDoc(doc(firestore, "companies", companyId), patch);
  try {
    const localRow = await getLocalCompanyById(companyId, { includeDeleted: true });
    if (localRow) {
      await upsertLocalCompany({
        ...localRow,
        ...patch,
        id: companyId,
        updatedAt: Date.now(),
      } as LocalCompanyDoc);
    }
  } catch {
    /* online-only / no local DB */
  }
  opts.reloadLocalCompanyRegistry?.();
  opts.triggerSync?.();
  return "firestore";
}
