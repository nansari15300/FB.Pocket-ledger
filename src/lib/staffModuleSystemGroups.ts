"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import { LOAN_LIABILITY_GROUP_ID } from "@/modules/loans/constants/loanConstants";
import { STAFF_SYSTEM_GROUP_ID } from "@/lib/staffSystemGroups";
import { writeEntity } from "@/lib/writeGateway";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";

export type StaffModuleSystemGroupSeed = {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
};

/** Loan & Liabilities = one staff-module system branch; Staff nested under it for salary ledgers. */
export const STAFF_MODULE_SYSTEM_GROUP_SEEDS: StaffModuleSystemGroupSeed[] = [
  {
    id: LOAN_LIABILITY_GROUP_ID,
    name: "Loans & Liabilities",
    type: "Liability",
    parentId: "liabilities",
  },
  {
    id: STAFF_SYSTEM_GROUP_ID,
    name: "Staff",
    type: "General",
    parentId: LOAN_LIABILITY_GROUP_ID,
  },
];

export function isStaffModuleLiabilitySystemGroupId(id?: string | null): boolean {
  const gid = String(id ?? "").trim();
  return gid === LOAN_LIABILITY_GROUP_ID || gid === STAFF_SYSTEM_GROUP_ID;
}

function seedPayload(
  seed: StaffModuleSystemGroupSeed,
  companyId: string,
  ownerId: string
): Record<string, unknown> {
  return {
    name: seed.name,
    type: seed.type,
    parentId: seed.parentId,
    companyId,
    ownerId,
    isDeleted: false,
    isSystemReserved: true,
    isReportOnly: false,
    isAutoUngrouped: false,
  };
}

/** Idempotent: create / repair Loan & Liabilities + nested Staff system groups. */
export async function ensureStaffModuleSystemGroups(
  companyId: string,
  ownerId: string
): Promise<void> {
  if (!companyId || !ownerId) return;

  for (const seed of STAFF_MODULE_SYSTEM_GROUP_SEEDS) {
    const local = await getCompanyDocFromBrowserDb(companyId, "staff_groups", seed.id);
    const localRow = local as Record<string, unknown> | null;
    const needsRepair =
      !localRow ||
      localRow.isDeleted === true ||
      String(localRow.parentId ?? "").trim() !== String(seed.parentId ?? "").trim() ||
      String(localRow.name ?? "").trim() !== seed.name;

    if (!needsRepair) continue;

    const payload = {
      ...seedPayload(seed, companyId, ownerId),
      ...(localRow?.createdAt != null ? { createdAt: localRow.createdAt } : {}),
    };

    const writeRes = await writeEntity({
      companyId,
      collectionName: "staff_groups",
      docId: seed.id,
      operation: localRow ? "update" : "create",
      data: payload,
      options: { merge: true },
    });

    if (writeRes.ok) continue;

    const ref = doc(firestore, `companies/${companyId}/staff_groups`, seed.id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await setDoc(ref, payload, { merge: true });
    } else {
      await setDoc(ref, { ...payload, createdAt: Date.now() });
    }
    await upsertCompanyDocInBrowserDb(companyId, "staff_groups", seed.id, payload);
    await enqueueCompanyDocOutbox(companyId, "staff_groups", snap.exists() ? "update" : "create", seed.id, payload);
  }
}
