"use client";

import { doc, updateDoc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import type { Company } from "@/hooks/useCompany";
import type { PermissionConfig } from "@/hooks/usePermissions";
import { normalizePermissionConfig } from "@/hooks/usePermissions";
import {
  listSpecialAccountAccessUsers,
  mergeSpecialAccountUsageIntoPermissionConfig,
  normalizeSpecialAccountUseFor,
  type SpecialAccountUseFor,
} from "@/lib/specialAccountUsage";
import { companyUsesDeviceOrPlPermissionConfig } from "@/lib/permissionConfigSource";
import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import { isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";

/** Bank special-account form ↔ Manage Sharing role permissions (usage defaults + balance role flags). */
export async function persistSpecialAccountUsagePermissionConfig(
  companyId: string,
  company: Company | null | undefined,
  useFor: SpecialAccountUseFor
): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid || !company) return;

  const users = listSpecialAccountAccessUsers(company);
  const base = normalizePermissionConfig(company.permissionConfig);
  const configToSave = mergeSpecialAccountUsageIntoPermissionConfig(
    base,
    normalizeSpecialAccountUseFor(useFor),
    users
  );

  const isOnlineFirebase =
    isCloudLinkedCompanyStorage(company) && !companyUsesDeviceOrPlPermissionConfig(company);

  if (!isOnlineFirebase && companyUsesDeviceOrPlPermissionConfig(company)) {
    const existing = await getLocalCompanyById(cid, { includeDeleted: true });
    if (!existing) return;
    await upsertLocalCompany({
      ...existing,
      id: cid,
      permissionConfig: configToSave,
      updatedAt: Date.now(),
    } as LocalCompanyDoc);
    try {
      const { flushPendingBrowserDbSave } = await import("@/lib/localSqlite");
      await flushPendingBrowserDbSave();
    } catch {
      /* ignore */
    }
    try {
      const { notifyPlServerHostCompanyMetaSaved } = await import("@/lib/plServerCompanyMetaSync");
      void notifyPlServerHostCompanyMetaSaved(cid, { permissionConfig: configToSave });
    } catch {
      /* ignore */
    }
    return;
  }

  const companyRef = doc(firestore, "companies", cid);
  const snap = await getDoc(companyRef);
  if (!snap.exists()) return;
  await updateDoc(companyRef, { permissionConfig: configToSave });
}
