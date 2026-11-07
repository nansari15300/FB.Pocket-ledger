import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import type { PlanId } from "@/config/plans";
import {
  applyPlanChangeOneTimeToFirestore,
  PENDING_PLAN_CHANGES_COLLECTION,
  type PlanChangeHistoryFirestore,
} from "@/lib/payments/planChangeApply";
import {
  isBillingGatewayAvailable,
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import { resolveBillingCaller } from "@/lib/server/billingCaller";

type Body = {
  /** Decoded eSewa redirect payload (status, transaction_uuid, total_amount, …). */
  decoded?: Record<string, unknown>;
};

/**
 * After eSewa redirects with `data` (base64 JSON), client decodes and POSTs here to apply proration.
 */
export async function POST(req: NextRequest) {
  try {
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status });
    }
    const decodedAuth = billingCaller.decoded;

    const body = (await req.json()) as Body;
    const decoded = body.decoded;
    if (!decoded || typeof decoded !== "object") {
      return NextResponse.json({ error: "decoded payload required" }, { status: 400 });
    }

    const status = String(decoded.status ?? "");
    const transactionUuid = String(decoded.transaction_uuid ?? "").trim();
    const totalRaw = decoded.total_amount;
    const totalNum =
      typeof totalRaw === "number" ? totalRaw : typeof totalRaw === "string" ? parseFloat(totalRaw) : NaN;

    if (status !== "COMPLETE" || !transactionUuid) {
      return NextResponse.json({ error: "Payment not complete" }, { status: 400 });
    }

    const db = billingCaller.db;
    const gwSnap = await db.doc("app_settings/payment_gateways").get();
    const gwRaw = gwSnap.exists ? (gwSnap.data() as Record<string, unknown>) : {};
    const gwKeys = mergeGatewayKeysWithEnv(gwRaw as GatewayKeys);
    const gwFlags = parseGatewayPaymentFlags(gwRaw);
    if (!isBillingGatewayAvailable("esewa", gwKeys, gwFlags)) {
      return NextResponse.json(
        { error: "eSewa payments are disabled or not configured.", code: "gateway_disabled" },
        { status: 403 }
      );
    }
    const pendingRef = db.collection(PENDING_PLAN_CHANGES_COLLECTION).doc(transactionUuid);
    const pendingSnap = await pendingRef.get();
    if (!pendingSnap.exists) {
      return NextResponse.json({ error: "Pending checkout not found" }, { status: 404 });
    }

    const p = pendingSnap.data()!;
    if (p.status !== "pending") {
      return NextResponse.json({ error: "This checkout was already processed" }, { status: 409 });
    }
    if (p.userId !== decodedAuth.uid) {
      return NextResponse.json({ error: "This payment belongs to another account" }, { status: 403 });
    }
    if (p.gateway !== "esewa") {
      return NextResponse.json({ error: "Not an eSewa pending checkout" }, { status: 400 });
    }

    const exp = p.expiresAt as admin.firestore.Timestamp;
    if (exp.toMillis() < Date.now()) {
      await pendingRef.update({ status: "cancelled" }).catch(() => {});
      return NextResponse.json({ error: "Checkout expired — start again from Billing." }, { status: 410 });
    }

    const netNpr = Number(p.netNpr);
    if (!Number.isFinite(totalNum) || Math.abs(totalNum - netNpr) > 0.02) {
      return NextResponse.json({ error: "Amount does not match quoted renewal" }, { status: 400 });
    }

    const planChangeHistory = p.planChangeHistory as PlanChangeHistoryFirestore;
    const applied = await applyPlanChangeOneTimeToFirestore({
      db,
      companyId: String(p.companyId),
      userId: String(p.userId),
      paymentId: transactionUuid,
      gateway: "esewa",
      amountNpr: netNpr,
      currency: "npr",
      targetPlanId: p.targetPlanId as PlanId,
      previousPlanId: p.previousPlanId != null ? String(p.previousPlanId) : null,
      planChangeHistory,
      newPlanExpiryMs: Number(p.newPlanExpiryMs),
      paymentStatus: "completed",
      historySource: "esewa_plan_change",
    });

    if (applied.ok === false) {
      return NextResponse.json({ error: applied.reason }, { status: 400 });
    }

    await pendingRef.update({
      status: "applied",
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-plan-change-esewa]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
