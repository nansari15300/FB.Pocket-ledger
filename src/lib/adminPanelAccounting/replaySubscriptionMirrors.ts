import type admin from "@/lib/server/pbAdminTypes";
import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";
import {
  isSubscriptionPaymentPaid,
  listAdminSubscriptionPayments,
} from "@/lib/adminPanelAccounting/subscriptionPaymentsSource";
import {
  mirrorSubscriptionPaymentWithUserLookup,
  syncAdminPanelSubscriberPartyProfile,
  syncMirroredSubscriptionVoucherBankAccount,
  upgradeLegacySubscriptionMirrorPair,
} from "@/lib/adminPanelAccounting/mirrorSubscriptionPayment";
import { subscriptionSaleMirrorVoucherId } from "@/lib/adminPanelCompany/subscriptionMirrorIds";

export type ReplaySubscriptionMirrorsResult = {
  scanned: number;
  mirrored: number;
  skippedExisting: number;
  skippedUnpaid: number;
  skippedZeroAmount: number;
  errors: number;
};

export async function replaySubscriptionMirrorsToAdminCompany(
  db: admin.firestore.Firestore,
  options?: { limit?: number }
): Promise<ReplaySubscriptionMirrorsResult> {
  const limit = Math.min(500, Math.max(1, options?.limit ?? 500));
  const rows = await listAdminSubscriptionPayments(db, limit);

  const result: ReplaySubscriptionMirrorsResult = {
    scanned: rows.length,
    mirrored: 0,
    skippedExisting: 0,
    skippedUnpaid: 0,
    skippedZeroAmount: 0,
    errors: 0,
  };

  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  const companyNameCache = new Map<string, string | null>();

  for (const row of rows) {
    if (!isSubscriptionPaymentPaid(row.status)) {
      result.skippedUnpaid += 1;
      continue;
    }
    if (row.amount <= 0) {
      result.skippedZeroAmount += 1;
      continue;
    }

    let customerCompanyName: string | null = null;
    if (row.companyId) {
      if (!companyNameCache.has(row.companyId)) {
        const snap = await db.collection("companies").doc(row.companyId).get();
        const data = snap.exists ? (snap.data() as Record<string, unknown>) : null;
        customerCompanyName =
          data != null ? String(data.name ?? data.companyName ?? "").trim() || null : null;
        companyNameCache.set(row.companyId, customerCompanyName);
      } else {
        customerCompanyName = companyNameCache.get(row.companyId) ?? null;
      }
    }

    const mirrorInput = {
      paymentId: row.paymentId,
      userId: row.userId || null,
      userEmail: row.userEmail ?? null,
      amountNpr: row.amount,
      gateway: row.gateway || "unknown",
      planId: row.planId || "advance",
      customerCompanyId: row.companyId || null,
      customerCompanyName,
      billingIntent: row.billingIntent,
      addonItems: row.addonItems,
      subscriptionTermKey: row.subscriptionTermKey,
    };

    const saleVoucherId = subscriptionSaleMirrorVoucherId(row.paymentId);
    const already = await companyRef.collection("vouchers").doc(saleVoucherId).get();
    if (already.exists) {
      try {
        await syncAdminPanelSubscriberPartyProfile(db, mirrorInput);
        await upgradeLegacySubscriptionMirrorPair(db, mirrorInput);
        await syncMirroredSubscriptionVoucherBankAccount(db, {
          paymentId: row.paymentId,
          gateway: row.gateway || "unknown",
        });
      } catch {
        result.errors += 1;
      }
      result.skippedExisting += 1;
      continue;
    }

    try {
      await mirrorSubscriptionPaymentWithUserLookup(db, mirrorInput);
      result.mirrored += 1;
    } catch {
      result.errors += 1;
    }
  }

  return result;
}
