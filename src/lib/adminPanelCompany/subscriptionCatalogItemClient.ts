"use client";

import { getPlan, normalizePlanIdForClient, type PlanId } from "@/config/plans";
import { readDeviceUserAddOnOfferFromPlansDoc } from "@/lib/planAddOns";
import { mergeAppSettingsPlansDoc } from "@/lib/mergeAppSettingsPlans";
import { resolvePlansCatalogForEntitlements } from "@/lib/plansCatalogCache";
import {
  isAdminPanelSubscriptionCatalogItemId,
  resolveAdminPanelSubscriptionCatalogFieldsFromCatalog,
  subscriptionPlanItemId,
  type AdminPanelSubscriptionCatalogFields,
} from "@/lib/adminPanelCompany/subscriptionCatalogItemPricing";
import { isAdminPanelCompanyLocalId } from "@/lib/adminPanelCompany/ledgerMode";

export function isAdminPanelSubscriptionCatalogItemForCompany(
  companyId: string | null | undefined,
  itemId: string
): boolean {
  return isAdminPanelCompanyLocalId(companyId) && isAdminPanelSubscriptionCatalogItemId(itemId);
}

export async function fetchAdminPanelSubscriptionCatalogFields(
  itemId: string
): Promise<AdminPanelSubscriptionCatalogFields | null> {
  if (!isAdminPanelSubscriptionCatalogItemId(itemId)) return null;
  const plansById = await resolvePlansCatalogForEntitlements();
  let addonOffer = readDeviceUserAddOnOfferFromPlansDoc(null);
  try {
    const { doc, getDoc: fsGetDoc } = await import("firebase/firestore");
    const { isPocketBaseAppSessionActive } = await import("@/lib/pocketbaseData/pbAppSession");
    let getDoc = fsGetDoc;
    let skip = false;
    if (isPocketBaseAppSessionActive()) {
      // Server login: Firestore is offline. Admin Panel (super admin) reads via the server; else cache defaults.
      const seam = await import("@/lib/pocketbaseData/pbReadSeam");
      if (seam.isAdminServerDataActive()) getDoc = seam.getDoc;
      else skip = true;
    }
    const { firestore } = await import("@/lib/firebase");
    const snap = skip ? null : await getDoc(doc(firestore, "app_settings", "plans"));
    if (snap && snap.exists()) {
      const raw = snap.data() as Record<string, unknown>;
      addonOffer = readDeviceUserAddOnOfferFromPlansDoc(raw);
      const list = mergeAppSettingsPlansDoc(raw);
      for (const p of list) {
        plansById[p.id as PlanId] = p;
      }
    }
  } catch {
    /* offline — cache defaults */
  }
  return resolveAdminPanelSubscriptionCatalogFieldsFromCatalog(itemId, plansById, addonOffer);
}

/** Subscription mirror sales: ensure `itemId` + sale line fields for CreateSaleForm. */
export function enrichSubscriptionMirrorSaleLineItemsForForm(
  voucher: Record<string, unknown> | null | undefined,
  lineItems: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const planId = String(voucher?.planId ?? "").trim();
  const kind = String(voucher?.kind ?? "").trim();
  const isSubscriptionMirror = kind === "subscription-payment";
  return lineItems.map((li) => {
    let itemId = String(li.itemId ?? li.id ?? "").trim();
    if (!itemId && isSubscriptionMirror && planId) {
      itemId = subscriptionPlanItemId(planId);
    }
    let name = String(li.name ?? "").trim();
    if (!name && itemId && isSubscriptionMirror && planId && isAdminPanelSubscriptionCatalogItemId(itemId)) {
      if (itemId.startsWith("system-item-plan-")) {
        name = `Plan: ${getPlan(normalizePlanIdForClient(planId)).name}`;
      }
    }
    return {
      ...li,
      type: li.type === "service" ? "service" : "item",
      itemId,
      name,
      quantity: li.quantity ?? 1,
      rate: li.rate ?? 0,
      amount: li.amount ?? 0,
      unit: li.unit ?? "",
      taxAccountId: li.taxAccountId ?? "",
      taxAmount: li.taxAmount ?? 0,
      isTaxInclusive: li.isTaxInclusive ?? false,
      allowManualRate: li.allowManualRate !== false,
    };
  });
}
