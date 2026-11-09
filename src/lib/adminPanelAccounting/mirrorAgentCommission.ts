import type admin from "@/lib/server/pbAdminTypes";

import { getPlan, normalizePlanIdForClient, type PlanId } from "@/config/plans";
import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  ADMIN_PANEL_SEED_AGENT_EXPENSE_ID,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";
import { seedAdminPanelCompanyDefaultMasters } from "@/lib/adminPanelCompany/seedDefaultMasters";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

export type MirrorAgentCommissionInput = {
  paymentId: string;
  userId: string | null;
  planId: string;
  /** Subscription receipt (incl. tax). */
  subscriptionAmount: number;
  /** Tax-exclusive sales portion used for commission base. */
  salesAmount: number;
  gateway: string;
};

async function resolveDistributorUid(
  db: admin.firestore.Firestore,
  subscriberUserId: string | null
): Promise<{ uid: string; name: string } | null> {
  const uid = (subscriberUserId || "").trim();
  if (!uid) return null;
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return null;
  const d = userSnap.data() as Record<string, unknown>;
  const refKeys = [
    "distributorUid",
    "distributorId",
    "distributorUserId",
    "referredBy",
    "referrerUserId",
    "invitedBy",
    "agentUid",
  ];
  for (const key of refKeys) {
    const distUid = String(d[key] ?? "").trim();
    if (!distUid) continue;
    const distSnap = await db.collection("users").doc(distUid).get();
    const name = distSnap.exists
      ? String(
          (distSnap.data() as Record<string, unknown>).displayName ??
            (distSnap.data() as Record<string, unknown>).name ??
            (distSnap.data() as Record<string, unknown>).email ??
            distUid
        ).trim()
      : distUid;
    return { uid: distUid, name: name || distUid };
  }
  return null;
}

function resolveCommissionRatePercent(
  settings: Record<string, unknown>,
  planId: string
): number {
  const fromSettings = Number(settings.agentCommissionRatePercent);
  if (Number.isFinite(fromSettings) && fromSettings > 0) {
    return Math.min(100, fromSettings);
  }
  const canon = normalizePlanIdForClient(planId) as PlanId;
  const fromPlan = Number(getPlan(canon).commissionRate ?? 0);
  if (Number.isFinite(fromPlan) && fromPlan > 0) return Math.min(100, fromPlan);
  return 0;
}

/**
 * Accrues agent commission payable when a subscriber payment is mirrored.
 * Idempotent per subscription `paymentId`. Never throws.
 */
export async function mirrorAgentCommissionForSubscription(
  db: admin.firestore.Firestore,
  input: MirrorAgentCommissionInput
): Promise<void> {
  try {
    const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
    if (!(await companyRef.get()).exists) return;

    const settingsSnap = await companyRef.collection("settings").doc("accounting").get();
    const settings = (settingsSnap.data() ?? {}) as Record<string, unknown>;
    if (settings.autoPostAgentCommission === false) return;

    const distributor = await resolveDistributorUid(db, input.userId);
    if (!distributor) return;

    const rate = resolveCommissionRatePercent(settings, input.planId);
    if (rate <= 0) return;

    const base = Math.max(0, Number(input.salesAmount) || Number(input.subscriptionAmount) || 0);
    if (base <= 0) return;

    const commissionAmount = Math.round((base * rate) / 100 * 100) / 100;
    if (commissionAmount <= 0) return;

    await seedAdminPanelCompanyDefaultMasters(db).catch(() => {});

    const voucherId = `commission-${input.paymentId}`.replace(/[^\w-]/g, "_").slice(0, 120);
    const voucherRef = companyRef.collection("vouchers").doc(voucherId);
    if ((await voucherRef.get()).exists) return;

    const expenseId =
      String(settings.defaultAgentCommissionExpenseId || ADMIN_PANEL_SEED_AGENT_EXPENSE_ID).trim() ||
      ADMIN_PANEL_SEED_AGENT_EXPENSE_ID;
    const now = serverTimestamp();
    const partyId = `agent-${distributor.uid}`.slice(0, 120);

    await companyRef.collection("parties").doc(partyId).set(
      {
        tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
        name: distributor.name,
        type: "agent",
        distributorUserId: distributor.uid,
        active: true,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );

    await voucherRef.set({
      tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
      kind: "agent-commission",
      voucherType: "journal",
      status: "posted",
      systemGenerated: true,
      locked: true,
      narration: `Agent commission ${rate}% on subscription ${input.planId} via ${input.gateway} (${distributor.name})`,
      amount: commissionAmount,
      commissionRatePercent: rate,
      commissionBaseAmount: base,
      partyId,
      partyName: distributor.name,
      expenseAccountId: expenseId,
      debitAccount: "agent-commission-expense",
      creditAccount: "agent-commission-payable",
      externalPaymentId: input.paymentId,
      gateway: input.gateway,
      planId: input.planId,
      postedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    console.error("[adminPanelAccounting] mirrorAgentCommission failed", err);
  }
}
