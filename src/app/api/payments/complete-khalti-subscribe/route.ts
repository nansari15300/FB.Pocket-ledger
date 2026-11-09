import { NextRequest, NextResponse } from "next/server";
import type admin from "@/lib/server/pbAdminTypes";

import type { PlanId } from "@/config/plans";
import {
  getKhaltiPaymentVerifyUrl,
  isBillingGatewayAvailable,
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  resolveKhaltiSecretKeyFromEnv,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import { PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION } from "@/lib/payments/pendingSubscriptionCheckout";
import { applyNewSubscriptionCheckoutToFirestore } from "@/lib/payments/subscriptionCheckoutApply";
import type { SubscriptionTermKey } from "@/lib/subscriptionPlanMath";
import { SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT } from "@/lib/subscriptionPlanMath";
import { resolveBillingCaller } from "@/lib/server/billingCaller";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

type Body = {
  pendingId?: string;
  token?: string;
  amount?: number;
};

/** Khalti widget success → pending row verify → plan activate. */
export async function POST(req: NextRequest) {
  try {
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status });
    }
    const decodedAuth = billingCaller.decoded;

    const body = (await req.json()) as Body;
    const pendingId = typeof body.pendingId === "string" ? body.pendingId.trim() : "";
    const khaltiToken = typeof body.token === "string" ? body.token.trim() : "";
    const amountPaisa = typeof body.amount === "number" ? body.amount : NaN;

    if (!pendingId || !khaltiToken) {
      return NextResponse.json({ error: "pendingId and token required" }, { status: 400 });
    }

    const db = billingCaller.db;
    const gwSnap = await db.doc("app_settings/payment_gateways").get();
    const gwRaw = gwSnap.exists ? (gwSnap.data() as Record<string, unknown>) : {};
    const gwKeys = mergeGatewayKeysWithEnv(gwRaw as GatewayKeys);
    const gwFlags = parseGatewayPaymentFlags(gwRaw);
    if (!isBillingGatewayAvailable("khalti", gwKeys, gwFlags)) {
      return NextResponse.json(
        { error: "Khalti payments are disabled or not configured.", code: "gateway_disabled" },
        { status: 403 }
      );
    }

    const pendingRef = db.collection(PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION).doc(pendingId);
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
    if (p.gateway !== "khalti") {
      return NextResponse.json({ error: "Not a Khalti checkout" }, { status: 400 });
    }

    const exp = p.expiresAt as admin.firestore.Timestamp;
    if (exp.toMillis() < Date.now()) {
      await pendingRef.update({ status: "cancelled" }).catch(() => {});
      return NextResponse.json({ error: "Checkout expired — start again from Billing." }, { status: 410 });
    }

    const amountNpr = Number(p.amountNpr);
    const expectedPaisa = Math.round(amountNpr * 100);
    if (!Number.isFinite(amountPaisa) || Math.abs(amountPaisa - expectedPaisa) > 2) {
      return NextResponse.json({ error: "Amount does not match checkout quote" }, { status: 400 });
    }

    const khaltiSecret = resolveKhaltiSecretKeyFromEnv();
    if (khaltiSecret) {
      const verifyRes = await fetch(getKhaltiPaymentVerifyUrl(), {
        method: "POST",
        headers: {
          Authorization: `Key ${khaltiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: khaltiToken, amount: amountPaisa }),
      });
      const verifyJson = (await verifyRes.json().catch(() => ({}))) as { detail?: string };
      if (!verifyRes.ok) {
        return NextResponse.json(
          { error: verifyJson.detail || "Khalti verification failed" },
          { status: 400 }
        );
      }
    }

    const termRaw = String(p.subscriptionTermKey ?? "year_1");
    const subscriptionTermKey: SubscriptionTermKey = SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT.has(
      termRaw as SubscriptionTermKey
    )
      ? (termRaw as SubscriptionTermKey)
      : "year_1";

    const applied = await applyNewSubscriptionCheckoutToFirestore({
      db,
      companyId: typeof p.companyId === "string" ? p.companyId : null,
      userId: String(p.userId),
      paymentId: pendingId,
      gateway: "khalti",
      amountNpr,
      currency: String(p.currency ?? "npr"),
      planId: p.planId as PlanId,
      subscriptionTermKey,
      billingIntent: p.billingIntent === "donation" ? "donation" : "subscribe",
    });

    if (applied.ok === false) {
      return NextResponse.json({ error: applied.reason }, { status: 400 });
    }

    await pendingRef.update({
      status: "applied",
      appliedAt: serverTimestamp(),
    });

    return NextResponse.json({ ok: true, mirrorLocal: applied.mirrorLocal ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-khalti-subscribe]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
