import type admin from "@/lib/server/pbAdminTypes";

import { getPlan, normalizePlanIdForClient, PLAN_TIER_ORDER, type Plan, type PlanId } from "@/config/plans";

import {

  ADMIN_PANEL_COMPANIES_COLLECTION,

  CLOUD_ADMIN_PANEL_TENANT_ID,

} from "@/lib/adminPanelCompany/constants";

import {

  pricingForAddonCatalogItem,

  pricingForPlanCatalogItem,

  subscriptionAddonItemId,

  subscriptionCatalogLineQuantityForTerm,

  subscriptionCatalogSaleUnitForTerm,

  subscriptionCatalogStockQty,

  inferSubscriptionCatalogTermFromSalesAmount,

  normalizeSubscriptionCatalogTermKey,

  subscriptionPlanItemId,

  ADMIN_PANEL_SUBSCRIPTION_SALE_UNIT,

  ADMIN_PANEL_SUBSCRIPTION_PLAN_GROUP_ID,

  ADMIN_PANEL_SUBSCRIPTION_PLAN_GROUP_NAME,

  ADMIN_PANEL_SUBSCRIPTION_ADDON_GROUP_ID,

  ADMIN_PANEL_SUBSCRIPTION_ADDON_GROUP_NAME,

} from "@/lib/adminPanelCompany/subscriptionCatalogItemPricing";

import { mergeAppSettingsPlansDoc } from "@/lib/mergeAppSettingsPlans";

import {

  addonKindLabel,

  normalizeAddonKind,

  readDeviceUserAddOnOfferFromPlansDoc,

  type AddonKind,

  type DeviceUserAddOnOffer,

} from "@/lib/planAddOns";



export {

  subscriptionAddonItemId,

  subscriptionPlanItemId,

} from "@/lib/adminPanelCompany/subscriptionCatalogItemPricing";



const ADDON_KINDS: AddonKind[] = [

  "device-online",

  "device-local",

  "user-online",

  "user-local",

  "company-online",

  "company-local",

];



async function loadAdminCatalogPricing(

  db: admin.firestore.Firestore

): Promise<{ plansById: Record<PlanId, Plan>; addonOffer: DeviceUserAddOnOffer }> {

  const snap = await db.doc("app_settings/plans").get();

  const raw = snap.exists ? (snap.data() as Record<string, unknown>) : {};

  const addonOffer = readDeviceUserAddOnOfferFromPlansDoc(raw);

  const plansById = {} as Record<PlanId, Plan>;

  for (const p of mergeAppSettingsPlansDoc(raw)) {

    plansById[p.id as PlanId] = p;

  }

  for (const id of PLAN_TIER_ORDER) {

    if (!plansById[id]) plansById[id] = getPlan(id);

  }

  return { plansById, addonOffer };

}



export type SubscriptionMirrorLineItem = {

  itemId: string;

  name: string;

  quantity: number;

  rate: number;

  amount: number;

  unit: string;

};

/** Sale form / SQLite voucher rows — full line shape + catalog label for combobox. */
export function subscriptionMirrorLinesToSaleFormLines(
  lines: SubscriptionMirrorLineItem[]
): Array<Record<string, unknown>> {
  return lines.map((line) => ({
    type: "item",
    itemId: line.itemId,
    name: line.name,
    quantity: line.quantity ?? 1,
    rate: line.rate ?? 0,
    unit: line.unit ?? "",
    amount: line.amount ?? 0,
    taxAccountId: "",
    taxAmount: 0,
    isTaxInclusive: false,
    allowManualRate: true,
  }));
}



export function parsePackedAddonItems(raw: string | null | undefined): Array<{ kind: AddonKind; quantity: number }> {

  const s = String(raw ?? "").trim();

  if (!s) return [];

  return s

    .split(",")

    .map((part) => part.trim())

    .filter(Boolean)

    .map((part) => {

      const [kindRaw, qtyRaw] = part.split(":");

      const quantity = Math.max(1, Math.floor(Number(qtyRaw) || 1));

      return { kind: normalizeAddonKind(kindRaw), quantity };

    });

}



import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

function seedAdminPanelCatalogItemGroups(batch: admin.firestore.WriteBatch, companyRef: admin.firestore.DocumentReference, tenantId: string,

  now: admin.firestore.FieldValue

): void {
  batch.set(

    companyRef.collection("item_groups").doc(ADMIN_PANEL_SUBSCRIPTION_PLAN_GROUP_ID),

    {

      tenantId,

      name: ADMIN_PANEL_SUBSCRIPTION_PLAN_GROUP_NAME,

      parentId: null,

      type: "item",

      systemGenerated: true,

      catalogSource: "admin_plans",

      active: true,

      updatedAt: now,

      createdAt: now,

    },

    { merge: true }

  );

  batch.set(

    companyRef.collection("item_groups").doc(ADMIN_PANEL_SUBSCRIPTION_ADDON_GROUP_ID),

    {

      tenantId,

      name: ADMIN_PANEL_SUBSCRIPTION_ADDON_GROUP_NAME,

      parentId: null,

      type: "item",

      systemGenerated: true,

      catalogSource: "admin_plans",

      active: true,

      updatedAt: now,

      createdAt: now,

    },

    { merge: true }

  );

}



/** Upsert service items for plans + add-on kinds (Admin Panel Company only). */

export async function ensureSubscriptionCatalogItems(

  db: admin.firestore.Firestore

): Promise<void> {

  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);

  if (!(await companyRef.get()).exists) return;



  const { plansById, addonOffer } = await loadAdminCatalogPricing(db);

  const now = serverTimestamp();

  const batch = db.batch();

  let writes = 0;

  seedAdminPanelCatalogItemGroups(batch, companyRef, CLOUD_ADMIN_PANEL_TENANT_ID, now as unknown as admin.firestore.FieldValue);

  writes += 2;



  for (const planId of PLAN_TIER_ORDER) {

    const plan = plansById[planId] ?? getPlan(planId);

    const id = subscriptionPlanItemId(planId);

    const priced = pricingForPlanCatalogItem(plan);

    batch.set(

      companyRef.collection("items").doc(id),

      {

        tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,

        name: priced.name,

        type: priced.type,

        groupId: priced.groupId,

        planId,

        systemGenerated: true,

        catalogSource: "admin_plans",

        salePrice: priced.salePrice,

        purchasePrice: priced.purchasePrice,

        salePriceUnit: priced.salePriceUnit,

        purchasePriceUnit: priced.purchasePriceUnit,

        openingBalance: priced.openingBalance,

        openingBalanceUnit: priced.openingBalanceUnit,

        openingBalanceRate: priced.openingBalanceRate,

        unitConversions: priced.unitConversions,

        stockQty: subscriptionCatalogStockQty(priced.openingBalance),

        active: true,

        // The PB adapter encodes this sentinel directly; the Admin type only knows `FieldValue`.
        updatedAt: now as unknown as admin.firestore.FieldValue,

        createdAt: now as unknown as admin.firestore.FieldValue,

      },

      { merge: true }

    );

    writes += 1;

  }



  for (const kind of ADDON_KINDS) {

    const id = subscriptionAddonItemId(kind);

    const priced = pricingForAddonCatalogItem(kind, addonOffer);

    batch.set(

      companyRef.collection("items").doc(id),

      {

        tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,

        name: priced.name,

        type: priced.type,

        groupId: priced.groupId,

        addonKind: kind,

        systemGenerated: true,

        catalogSource: "admin_plans",

        salePrice: priced.salePrice,

        purchasePrice: priced.purchasePrice,

        salePriceUnit: priced.salePriceUnit,

        purchasePriceUnit: priced.purchasePriceUnit,

        openingBalance: priced.openingBalance,

        openingBalanceUnit: priced.openingBalanceUnit,

        openingBalanceRate: priced.openingBalanceRate,

        unitConversions: priced.unitConversions,

        stockQty: subscriptionCatalogStockQty(priced.openingBalance),

        active: true,

        // The PB adapter encodes this sentinel directly; the Admin type only knows `FieldValue`.
        updatedAt: now as unknown as admin.firestore.FieldValue,

        createdAt: now as unknown as admin.firestore.FieldValue,

      },

      { merge: true }

    );

    writes += 1;

  }



  if (writes > 0) await batch.commit();

}



export function buildSubscriptionMirrorLineItems(input: {

  planId: string;

  amountNpr: number;

  salesAmount: number;

  billingIntent?: string | null;

  addonItems?: string | null;

  subscriptionTermKey?: string | null;

}): SubscriptionMirrorLineItem[] {

  const amount = Math.max(0, Number(input.amountNpr) || 0);

  const salesAmount = Math.max(0, Number(input.salesAmount) || amount);

  const intent = String(input.billingIntent ?? "subscribe").trim().toLowerCase();

  const addonRows = parsePackedAddonItems(input.addonItems);



  if (intent === "addon_bundle" && addonRows.length > 0) {

    const totalQty = addonRows.reduce((s, r) => s + r.quantity, 0) || 1;

    let allocated = 0;

    const lines: SubscriptionMirrorLineItem[] = [];

    addonRows.forEach((row, idx) => {

      const isLast = idx === addonRows.length - 1;

      const share = isLast

        ? Math.round((salesAmount - allocated) * 100) / 100

        : Math.round((salesAmount * row.quantity) / totalQty * 100) / 100;

      allocated += share;

      const rate = row.quantity > 0 ? Math.round((share / row.quantity) * 100) / 100 : share;

      lines.push({

        itemId: subscriptionAddonItemId(row.kind),

        name: `Add-on: ${addonKindLabel(row.kind, row.quantity)}`,

        quantity: row.quantity,

        rate,

        amount: share,

        unit: ADMIN_PANEL_SUBSCRIPTION_SALE_UNIT,

      });

    });

    return lines.filter((l) => l.amount > 0);

  }



  const planId = normalizePlanIdForClient(input.planId) as PlanId;

  const plan = getPlan(planId);

  const priced = pricingForPlanCatalogItem(plan);

  const monthly = Math.max(0, Number(plan.price?.monthly) || 0);

  const yearly = Math.max(0, Number(plan.price?.yearly) || monthly * 12);

  const termRaw = String(input.subscriptionTermKey ?? "").trim();

  const term = termRaw

    ? normalizeSubscriptionCatalogTermKey(termRaw)

    : inferSubscriptionCatalogTermFromSalesAmount(salesAmount, monthly, yearly);

  const unit = subscriptionCatalogSaleUnitForTerm(term);

  const quantity = subscriptionCatalogLineQuantityForTerm(term);

  const rate =

    quantity > 0 ? Math.round((salesAmount / quantity) * 100) / 100 : salesAmount;

  return [

    {

      itemId: subscriptionPlanItemId(planId),

      name: priced.name,

      quantity,

      rate,

      amount: salesAmount,

      unit,

    },

  ];

}


