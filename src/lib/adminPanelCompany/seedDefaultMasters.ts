import type admin from "@/lib/server/pbAdminTypes";

import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  ADMIN_PANEL_SEED_AGENT_EXPENSE_ID,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";
import {
  ADMIN_PANEL_GATEWAY_BANK_IDS,
  seedPaymentGatewayBanksForAdminCompany,
} from "@/lib/adminPanelCompany/seedPaymentGatewayBanks";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

export async function seedAdminPanelCompanyDefaultMasters(
  db: admin.firestore.Firestore
): Promise<void> {
  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  const snap = await companyRef.get();
  if (!snap.exists) return;

  const now = serverTimestamp();
  const tenantId = CLOUD_ADMIN_PANEL_TENANT_ID;

  const expenseRef = companyRef.collection("expense_accounts").doc(ADMIN_PANEL_SEED_AGENT_EXPENSE_ID);
  const settingsRef = companyRef.collection("settings").doc("accounting");

  const batch = db.batch();

  batch.set(
    expenseRef,
    {
      tenantId,
      name: "Agent Commission",
      type: "expense",
      ledgerAccountId: "agent-commission-expense",
      systemGenerated: true,
      active: true,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );

  batch.set(
    settingsRef,
    {
      tenantId,
      defaultGatewayBankId: ADMIN_PANEL_GATEWAY_BANK_IDS.stripe,
      defaultAgentCommissionExpenseId: ADMIN_PANEL_SEED_AGENT_EXPENSE_ID,
      subscriptionTaxRatePercent: 0,
      subscriptionTaxLedgerAccountId: "tax-payable",
      agentCommissionRatePercent: 0,
      autoPostAgentCommission: true,
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();
  await seedPaymentGatewayBanksForAdminCompany(db).catch((e) =>
    console.warn("[adminPanelCompany] seed payment gateway banks", e)
  );
}
