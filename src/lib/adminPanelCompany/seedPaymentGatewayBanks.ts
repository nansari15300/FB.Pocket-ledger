import type admin from "@/lib/server/pbAdminTypes";

import {
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  resolveBillingGatewayAvailability,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  ADMIN_PANEL_SEED_GATEWAY_BANK_ID,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

export const ADMIN_PANEL_GATEWAY_BANK_IDS = {
  stripe: "system-payment-gateway-stripe",
  khalti: "system-payment-gateway-khalti",
  esewa: "system-payment-gateway-esewa",
} as const;

export type BillingGatewayId = keyof typeof ADMIN_PANEL_GATEWAY_BANK_IDS;

const GATEWAY_LABELS: Record<BillingGatewayId, string> = {
  stripe: "Stripe",
  khalti: "Khalti",
  esewa: "eSewa",
};

export function resolveAdminPanelGatewayBankDisplayName(
  gatewayBankId: string,
  gateway?: string
): string {
  const id = String(gatewayBankId || "").trim();
  for (const key of Object.keys(ADMIN_PANEL_GATEWAY_BANK_IDS) as BillingGatewayId[]) {
    if (ADMIN_PANEL_GATEWAY_BANK_IDS[key] === id) return GATEWAY_LABELS[key];
  }
  const g = String(gateway || "").toLowerCase();
  if (g.includes("stripe")) return GATEWAY_LABELS.stripe;
  if (g.includes("khalti")) return GATEWAY_LABELS.khalti;
  if (g.includes("esewa") || g.includes("e-sewa")) return GATEWAY_LABELS.esewa;
  return "Payment Gateway";
}

/** Map subscription payment gateway string → bank_accounts doc id in Admin Panel Company. */
export function resolveAdminPanelGatewayBankId(
  gateway: string,
  settings?: Record<string, unknown>
): string {
  const g = String(gateway || "").toLowerCase().trim();
  if (g.includes("stripe")) return ADMIN_PANEL_GATEWAY_BANK_IDS.stripe;
  if (g.includes("khalti")) return ADMIN_PANEL_GATEWAY_BANK_IDS.khalti;
  if (g.includes("esewa") || g.includes("e-sewa")) return ADMIN_PANEL_GATEWAY_BANK_IDS.esewa;
  const fallback = String(settings?.defaultGatewayBankId ?? ADMIN_PANEL_SEED_GATEWAY_BANK_ID).trim();
  return fallback || ADMIN_PANEL_SEED_GATEWAY_BANK_ID;
}

/** Upsert bank rows for Stripe / Khalti / eSewa when configured in `app_settings/payment_gateways`. */
export async function seedPaymentGatewayBanksForAdminCompany(
  db: admin.firestore.Firestore
): Promise<{ stripe: boolean; khalti: boolean; esewa: boolean }> {
  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) {
    return { stripe: false, khalti: false, esewa: false };
  }

  const settingsSnap = await db.doc("app_settings/payment_gateways").get();
  const raw = settingsSnap.exists ? (settingsSnap.data() as Record<string, unknown>) : {};
  const keys = mergeGatewayKeysWithEnv(raw as GatewayKeys);
  const flags = parseGatewayPaymentFlags(raw);
  const avail = resolveBillingGatewayAvailability(keys, flags);

  const now = serverTimestamp();
  const batch = db.batch();
  let writes = 0;

  for (const id of Object.keys(ADMIN_PANEL_GATEWAY_BANK_IDS) as BillingGatewayId[]) {
    if (!avail[id]) continue;
    const label = GATEWAY_LABELS[id];
    batch.set(
      companyRef.collection("bank_accounts").doc(ADMIN_PANEL_GATEWAY_BANK_IDS[id]),
      {
        tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
        name: label,
        accountType: "Bank",
        type: "bank",
        bankName: `${label} (subscription)`,
        paymentGateway: id,
        accountNumber: "",
        openingBalance: 0,
        ledgerAccountId: "gateway-clearing",
        systemGenerated: true,
        active: true,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );
    writes += 1;
  }

  const legacyGatewayRef = companyRef.collection("bank_accounts").doc(ADMIN_PANEL_SEED_GATEWAY_BANK_ID);
  batch.set(
    legacyGatewayRef,
    {
      tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
      active: false,
      systemGenerated: true,
      updatedAt: now,
    },
    { merge: true }
  );
  writes += 1;

  const firstEnabled = (Object.keys(ADMIN_PANEL_GATEWAY_BANK_IDS) as BillingGatewayId[]).find(
    (id) => avail[id]
  );
  if (firstEnabled) {
    batch.set(
      companyRef.collection("settings").doc("accounting"),
      {
        defaultGatewayBankId: ADMIN_PANEL_GATEWAY_BANK_IDS[firstEnabled],
        updatedAt: now,
      },
      { merge: true }
    );
    writes += 1;
  }

  if (writes > 0) await batch.commit();
  return avail;
}
