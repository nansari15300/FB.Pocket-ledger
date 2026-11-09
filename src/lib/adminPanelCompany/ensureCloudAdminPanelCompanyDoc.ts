import type admin from "@/lib/server/pbAdminTypes";

import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  ADMIN_PANEL_COMPANY_NAME,
  ADMIN_PANEL_DEFAULT_LEDGER_ACCOUNTS,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";
import { seedAdminPanelCompanyDefaultMasters } from "@/lib/adminPanelCompany/seedDefaultMasters";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

/**
 * Ensure cloud Admin Panel Company + accounting settings exist so payment mirrors
 * are not silently dropped when SuperAdmin never opened Admin Panel first.
 */
export async function ensureCloudAdminPanelCompanyDoc(
  db: admin.firestore.Firestore,
  createdBy?: { uid?: string | null; email?: string | null }
): Promise<boolean> {
  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  const snap = await companyRef.get();
  if (snap.exists) {
    await seedAdminPanelCompanyDefaultMasters(db).catch(() => {});
    return true;
  }

  const now = serverTimestamp();
  const batch = db.batch();
  batch.create(companyRef, {
    tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
    licenseId: null,
    name: ADMIN_PANEL_COMPANY_NAME,
    kind: "admin-panel-company",
    status: "active",
    createdByUid: createdBy?.uid ?? "system-payment-mirror",
    createdByEmail: createdBy?.email ?? null,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    createdVia: "payment_mirror_auto",
  });
  batch.set(companyRef.collection("settings").doc("accounting"), {
    tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
    autoPostSubscriptions: true,
    autoPostAgentCommission: true,
    autoVoucherPolicy: "system-locked",
    createdAt: now,
    updatedAt: now,
  });
  for (const account of ADMIN_PANEL_DEFAULT_LEDGER_ACCOUNTS) {
    batch.set(companyRef.collection("ledger_accounts").doc(account.id), {
      ...account,
      tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  try {
    await batch.commit();
  } catch (e: unknown) {
    const again = await companyRef.get();
    if (!again.exists) {
      console.error("[ensureCloudAdminPanelCompanyDoc] create failed", e);
      return false;
    }
  }
  await seedAdminPanelCompanyDefaultMasters(db).catch(() => {});
  return true;
}
