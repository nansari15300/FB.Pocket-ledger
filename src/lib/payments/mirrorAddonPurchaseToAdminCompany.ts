import "server-only";
import type admin from "@/lib/server/pbAdminTypes";
import { mirrorSubscriptionPaymentWithUserLookup } from "@/lib/adminPanelAccounting/mirrorSubscriptionPayment";
import { packAddonItemsForStorage, type AddonPurchaseLine } from "@/lib/payments/addonItemsPacked";

export async function mirrorAddonPurchaseToAdminCompany(
  db: admin.firestore.Firestore,
  input: {
    paymentId: string;
    userId: string;
    companyId: string;
    amount: number;
    gateway: string;
    items: readonly AddonPurchaseLine[];
  }
): Promise<void> {
  const paymentId = String(input.paymentId || "").trim();
  const userId = String(input.userId || "").trim();
  const companyId = String(input.companyId || "").trim();
  const amountNpr = Math.max(0, Number(input.amount) || 0);
  if (!paymentId || !userId || !companyId || amountNpr <= 0) return;
  if (!input.items?.length) return;

  const companySnap = await db.collection("companies").doc(companyId).get();
  const cdata = (companySnap.exists ? companySnap.data() : {}) as Record<string, unknown>;
  const planId = String(cdata.planId ?? "basic").trim() || "basic";
  const customerCompanyName =
    String(cdata.name ?? cdata.companyName ?? "").trim() || null;

  await mirrorSubscriptionPaymentWithUserLookup(db, {
    paymentId,
    userId,
    amountNpr,
    gateway: input.gateway,
    planId,
    customerCompanyId: companyId,
    customerCompanyName,
    billingIntent: "addon_bundle",
    addonItems: packAddonItemsForStorage(input.items),
  });
}
