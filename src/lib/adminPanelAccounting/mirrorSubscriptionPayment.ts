import type admin from "@/lib/server/pbAdminTypes";

import {

  ADMIN_PANEL_COMPANIES_COLLECTION,

  CLOUD_ADMIN_PANEL_TENANT_ID,

} from "@/lib/adminPanelCompany/constants";

import { seedAdminPanelCompanyDefaultMasters } from "@/lib/adminPanelCompany/seedDefaultMasters";

import {

  resolveAdminPanelGatewayBankDisplayName,

  resolveAdminPanelGatewayBankId,

} from "@/lib/adminPanelCompany/seedPaymentGatewayBanks";

import {

  subscriptionReceiptMirrorVoucherId,

  subscriptionSaleMirrorVoucherId,

} from "@/lib/adminPanelCompany/subscriptionMirrorIds";

import { resolveSubscriberPartyNameForMirror } from "@/lib/adminPanelCompany/subscriberPartyListDisplay";

import { mirrorAgentCommissionForSubscription } from "@/lib/adminPanelAccounting/mirrorAgentCommission";

import {

  buildSubscriptionMirrorLineItems,

  ensureSubscriptionCatalogItems,

  subscriptionMirrorLinesToSaleFormLines,

} from "@/lib/adminPanelAccounting/subscriptionCatalogItems";



import { deleteField, serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

export type MirrorSubscriptionPaymentInput = {

  paymentId: string;

  userId: string | null;

  userName?: string | null;

  userEmail?: string | null;

  amountNpr: number;

  gateway: string;

  planId: string;

  customerCompanyId?: string | null;

  customerCompanyName?: string | null;

  billingIntent?: string | null;

  addonItems?: string | null;

  subscriptionTermKey?: string | null;

};



function partyDocId(userId: string | null, paymentId: string) {

  const uid = (userId || "").trim();

  return uid ? `subscriber-${uid}` : `subscriber-guest-${paymentId.slice(0, 48)}`;

}



/**

 * Subscriber ledger = sale; bank ledger = payment_in (receipt) linked to that sale.

 */

export async function mirrorSubscriptionPaymentToAdminCompany(

  db: admin.firestore.Firestore,

  input: MirrorSubscriptionPaymentInput

): Promise<void> {

  try {

    const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);

    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      const { ensureCloudAdminPanelCompanyDoc } = await import(
        "@/lib/adminPanelCompany/ensureCloudAdminPanelCompanyDoc"
      );
      const ready = await ensureCloudAdminPanelCompanyDoc(db, {
        uid: input.userId,
        email: input.userEmail,
      });
      if (!ready) return;
    }

    const settingsSnap = await companyRef.collection("settings").doc("accounting").get();

    const settings = (settingsSnap.data() ?? {}) as Record<string, unknown>;

    if (settings.autoPostSubscriptions === false) return;



    await seedAdminPanelCompanyDefaultMasters(db).catch(() => {});

    await ensureSubscriptionCatalogItems(db).catch(() => {});



    const partyId = partyDocId(input.userId, input.paymentId);

    const partyName = resolveSubscriberPartyNameForMirror(input);

    const partyRef = companyRef.collection("parties").doc(partyId);

    const now = serverTimestamp();



    await partyRef.set(

      {

        tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,

        name: partyName,

        email: (input.userEmail || "").trim(),

        phone: "",

        address: "",

        openingBalance: 0,

        type: "subscriber",

        subscriberUserId: input.userId,

        active: true,

        updatedAt: now,

        createdAt: now,

      },

      { merge: true }

    );



    const saleVoucherId = subscriptionSaleMirrorVoucherId(input.paymentId);

    const receiptVoucherId = subscriptionReceiptMirrorVoucherId(input.paymentId);

    const saleRef = companyRef.collection("vouchers").doc(saleVoucherId);

    const receiptRef = companyRef.collection("vouchers").doc(receiptVoucherId);



    const saleExisting = await saleRef.get();

    const receiptExisting = await receiptRef.get();

    if (saleExisting.exists && receiptExisting.exists) return;



    const amount = Math.max(0, Number(input.amountNpr) || 0);

    if (amount <= 0) return;



    const rate = Math.min(100, Math.max(0, Number(settings.subscriptionTaxRatePercent) || 0));

    const taxAmount = rate > 0 ? Math.round((amount * rate) / 100 * 100) / 100 : 0;

    const salesAmount = Math.round((amount - taxAmount) * 100) / 100;



    const gatewayBankId = resolveAdminPanelGatewayBankId(input.gateway, settings);

    const gatewayBankName = resolveAdminPanelGatewayBankDisplayName(gatewayBankId, input.gateway);

    const taxLedgerId = String(settings.subscriptionTaxLedgerAccountId || "tax-payable").trim();



    const billingIntentNorm = String(input.billingIntent ?? "").trim().toLowerCase();
    const narrationParts =
      billingIntentNorm === "addon_bundle"
        ? [
            "Add-on purchase",
            input.gateway ? `via ${input.gateway}` : null,
            input.customerCompanyName ? `(${input.customerCompanyName})` : null,
          ].filter(Boolean)
        : [
            `Subscription ${input.planId}`,
            input.gateway ? `via ${input.gateway}` : null,
            input.customerCompanyName ? `(${input.customerCompanyName})` : null,
          ].filter(Boolean);

    const narration = narrationParts.join(" ");



    const lineItems = subscriptionMirrorLinesToSaleFormLines(
      buildSubscriptionMirrorLineItems({
        planId: input.planId,
        amountNpr: amount,
        salesAmount,
        billingIntent: input.billingIntent,
        addonItems: input.addonItems,
        subscriptionTermKey: input.subscriptionTermKey,
      })
    );



    if (!saleExisting.exists) {

      await saleRef.set({

        tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,

        kind: "subscription-payment",
        userDisplayName: "Auto",

        voucherType: "sale",

        status: "posted",

        systemGenerated: true,

        locked: true,

        narration,

        amount,

        total: amount,

        subTotal: salesAmount,

        salesAmount,

        taxAmount,

        taxRatePercent: rate,

        partyId,

        partyName,

        salesAccountId: "subscription-sales",

        taxAccountId: taxAmount > 0 ? taxLedgerId : null,

        paymentStatus: "paid",

        lineItems,

        externalPaymentId: input.paymentId,

        gateway: input.gateway,

        planId: input.planId,

        subscriptionTermKey: input.subscriptionTermKey ?? null,

        customerCompanyId: input.customerCompanyId ?? null,

        postedAt: now,

        createdAt: now,

        updatedAt: now,

      });

    }



    if (!receiptExisting.exists) {

      await receiptRef.set({

        tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,

        kind: "subscription-receipt",
        userDisplayName: "Auto",

        voucherType: "payment_in",

        status: "posted",

        systemGenerated: true,

        locked: true,

        narration: `Receipt — ${narration}`,

        amount,

        total: amount,

        partyId,

        partyName,

        accountId: gatewayBankId,

        bankAccountId: gatewayBankId,

        bankAccountName: gatewayBankName,

        allocations: [{ voucherId: saleVoucherId, amount }],

        externalPaymentId: input.paymentId,

        gateway: input.gateway,

        postedAt: now,

        createdAt: now,

        updatedAt: now,

      });

    }



    await mirrorAgentCommissionForSubscription(db, {

      paymentId: input.paymentId,

      userId: input.userId,

      planId: input.planId,

      subscriptionAmount: amount,

      salesAmount,

      gateway: input.gateway,

    });

  } catch (err) {

    console.error("[adminPanelAccounting] mirrorSubscriptionPayment failed", err);

  }

}



/** Legacy single sale-with-bank rows → sale + payment_in pair. */

export async function upgradeLegacySubscriptionMirrorPair(

  db: admin.firestore.Firestore,

  input: MirrorSubscriptionPaymentInput

): Promise<void> {

  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);

  if (!(await companyRef.get()).exists) return;



  const saleVoucherId = subscriptionSaleMirrorVoucherId(input.paymentId);

  const receiptVoucherId = subscriptionReceiptMirrorVoucherId(input.paymentId);

  const saleRef = companyRef.collection("vouchers").doc(saleVoucherId);

  const receiptRef = companyRef.collection("vouchers").doc(receiptVoucherId);



  const saleSnap = await saleRef.get();

  if (!saleSnap.exists) return;



  const receiptSnap = await receiptRef.get();

  const saleData = saleSnap.data() as Record<string, unknown>;

  const now = serverTimestamp();



  const settingsSnap = await companyRef.collection("settings").doc("accounting").get();

  const settings = (settingsSnap.data() ?? {}) as Record<string, unknown>;

  const gatewayBankId = resolveAdminPanelGatewayBankId(input.gateway, settings);

  const gatewayBankName = resolveAdminPanelGatewayBankDisplayName(gatewayBankId, input.gateway);



  const amount = Math.max(0, Number(saleData.amount ?? input.amountNpr) || 0);

  const rate = Math.min(100, Math.max(0, Number(saleData.taxRatePercent ?? settings.subscriptionTaxRatePercent) || 0));

  const taxAmount = Number(saleData.taxAmount) || (rate > 0 ? Math.round((amount * rate) / 100 * 100) / 100 : 0);

  const salesAmount =

    Number(saleData.salesAmount) || Math.round((amount - taxAmount) * 100) / 100;



  await ensureSubscriptionCatalogItems(db).catch(() => {});



  const lineItems = subscriptionMirrorLinesToSaleFormLines(
    buildSubscriptionMirrorLineItems({
      planId: String(saleData.planId ?? input.planId),
      amountNpr: amount,
      salesAmount,
      billingIntent: input.billingIntent ?? String(saleData.billingIntent ?? ""),
      addonItems: input.addonItems,
      subscriptionTermKey:
        input.subscriptionTermKey ?? String(saleData.subscriptionTermKey ?? ""),
    })
  );



  await saleRef.set(

    {

      salesAccountId: saleData.salesAccountId ?? "subscription-sales",

      subTotal: salesAmount,

      paymentStatus: "paid",

      lineItems,

      accountId: deleteField(),

      bankAccountId: deleteField(),

      bankAccountName: deleteField(),

      debitAccount: deleteField(),

      creditAccount: deleteField(),

      updatedAt: now,

    },

    { merge: true }

  );



  if (!receiptSnap.exists && amount > 0) {

    const narration = String(saleData.narration ?? `Subscription ${input.planId}`);

    await receiptRef.set({

      tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,

      kind: "subscription-receipt",

      voucherType: "payment_in",

      status: "posted",

      systemGenerated: true,

      locked: true,

      narration: `Receipt — ${narration}`,

      amount,

      total: amount,

      partyId: String(saleData.partyId ?? ""),

      partyName: String(saleData.partyName ?? ""),

      accountId: gatewayBankId,

      bankAccountId: gatewayBankId,

      bankAccountName: gatewayBankName,

      allocations: [{ voucherId: saleVoucherId, amount }],

      externalPaymentId: input.paymentId,

      gateway: input.gateway,

      postedAt: saleData.postedAt ?? now,

      createdAt: saleData.createdAt ?? now,

      updatedAt: now,

    });

  } else if (receiptSnap.exists) {

    await receiptRef.set(

      {

        accountId: gatewayBankId,

        bankAccountId: gatewayBankId,

        bankAccountName: gatewayBankName,

        gateway: input.gateway,

        updatedAt: now,

      },

      { merge: true }

    );

  }

}



export async function syncMirroredSubscriptionVoucherBankAccount(

  db: admin.firestore.Firestore,

  input: Pick<MirrorSubscriptionPaymentInput, "paymentId" | "gateway">

): Promise<void> {

  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);

  if (!(await companyRef.get()).exists) return;



  const settingsSnap = await companyRef.collection("settings").doc("accounting").get();

  const settings = (settingsSnap.data() ?? {}) as Record<string, unknown>;

  const gatewayBankId = resolveAdminPanelGatewayBankId(input.gateway, settings);

  const gatewayBankName = resolveAdminPanelGatewayBankDisplayName(gatewayBankId, input.gateway);



  const receiptVoucherId = subscriptionReceiptMirrorVoucherId(input.paymentId);

  const receiptRef = companyRef.collection("vouchers").doc(receiptVoucherId);

  const existing = await receiptRef.get();

  if (!existing.exists) {

    await upgradeLegacySubscriptionMirrorPair(db, {

      paymentId: input.paymentId,

      userId: null,

      amountNpr: 0,

      gateway: input.gateway,

      planId: "advance",

    });

    return;

  }



  const now = serverTimestamp();

  await receiptRef.set(

    {

      accountId: gatewayBankId,

      bankAccountId: gatewayBankId,

      bankAccountName: gatewayBankName,

      gateway: input.gateway,

      updatedAt: now,

    },

    { merge: true }

  );

}



export async function syncAdminPanelSubscriberPartyProfile(

  db: admin.firestore.Firestore,

  input: MirrorSubscriptionPaymentInput

): Promise<void> {

  let userName = input.userName ?? null;

  let userEmail = input.userEmail ?? null;

  const uid = (input.userId || "").trim();

  if (uid && !userName && !userEmail) {

    const userSnap = await db.collection("users").doc(uid).get();

    if (userSnap.exists) {

      const u = userSnap.data() as Record<string, unknown>;

      userName = String(u.displayName ?? u.name ?? u.email ?? "").trim() || null;

      userEmail = String(u.email ?? "").trim() || null;

    }

  }

  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);

  if (!(await companyRef.get()).exists) return;

  const partyId = partyDocId(input.userId, input.paymentId);

  const partyName = resolveSubscriberPartyNameForMirror({

    userName,

    userEmail,

    customerCompanyName: input.customerCompanyName,

  });

  const now = serverTimestamp();

  await companyRef.collection("parties").doc(partyId).set(

    {

      tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,

      name: partyName,

      email: (userEmail || "").trim(),

      type: "subscriber",

      subscriberUserId: input.userId,

      active: true,

      updatedAt: now,

    },

    { merge: true }

  );

}



export async function mirrorSubscriptionPaymentWithUserLookup(

  db: admin.firestore.Firestore,

  input: MirrorSubscriptionPaymentInput

): Promise<void> {

  let userName = input.userName ?? null;

  let userEmail = input.userEmail ?? null;

  const uid = (input.userId || "").trim();

  if (uid && !userName && !userEmail) {

    const userSnap = await db.collection("users").doc(uid).get();

    if (userSnap.exists) {

      const u = userSnap.data() as Record<string, unknown>;

      userName = String(u.displayName ?? u.name ?? u.email ?? "").trim() || null;

      userEmail = String(u.email ?? "").trim() || null;

    }

  }

  await mirrorSubscriptionPaymentToAdminCompany(db, {

    ...input,

    userName,

    userEmail,

  });

}


