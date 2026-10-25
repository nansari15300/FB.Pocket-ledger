import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import Stripe from "stripe";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isCompanyOwner } from "@/lib/server/companyOwner";
import { mergeGatewayKeysWithEnv, type GatewayKeys } from "@/ai/flows/gateway-keys";
import { syncCompanyPlanExpiryFromStripe } from "@/lib/payments/syncCompanyPlanExpiryFromStripe";
import { resolveBillingCaller } from "@/lib/server/billingCaller";

type Body = { companyId?: string };

async function getGatewayKeysFromAdmin(): Promise<{ stored: GatewayKeys; adminReadOk: boolean }> {
  try {
    const db = getAdminDb();
    const snap = await db.doc("app_settings/payment_gateways").get();
    return { stored: (snap.exists ? (snap.data() as GatewayKeys) : {}) as GatewayKeys, adminReadOk: true };
  } catch {
    return { stored: {}, adminReadOk: false };
  }
}

/**
 * Owner-only: agar company par `planExpiry` missing ho aur `stripeSubscriptionId` ho — Stripe period end se Firestore patch.
 * Billing page mount par call karke "Expiry N/A" + lost proration baseline dono mitigate.
 */
export async function POST(req: NextRequest) {
  try {
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status });
    }
    const decoded = billingCaller.decoded;

    const body = (await req.json()) as Body;
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    if (!companyId) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 });
    }

    const db = billingCaller.db;
    const companyRef = db.collection("companies").doc(companyId);
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const cdata = companySnap.data() as {
      ownerId?: string;
      ownerEmail?: string;
      planExpiry?: admin.firestore.Timestamp;
      planExpiryMs?: number;
      stripeSubscriptionId?: string;
    };
    if (!isCompanyOwner(decoded, cdata)) {
      return NextResponse.json({ error: "Only the company owner can repair plan expiry" }, { status: 403 });
    }

    const fromTs = cdata.planExpiry?.toMillis?.() ?? null;
    if (fromTs != null && Number.isFinite(fromTs)) {
      return NextResponse.json({ ok: true, planExpiryMs: fromTs, backfilled: false });
    }
    if (typeof cdata.planExpiryMs === "number" && Number.isFinite(cdata.planExpiryMs)) {
      return NextResponse.json({ ok: true, planExpiryMs: cdata.planExpiryMs, backfilled: false });
    }

    const subId = typeof cdata.stripeSubscriptionId === "string" ? cdata.stripeSubscriptionId.trim() : "";
    if (!subId) {
      return NextResponse.json({ ok: true, planExpiryMs: null, backfilled: false, reason: "no_stripe_subscription" });
    }

    const { stored } = await getGatewayKeysFromAdmin();
    const keys = mergeGatewayKeysWithEnv(stored);
    const sk = keys.stripeSecretKey?.trim();
    if (!sk) {
      return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });
    }

    const stripe = new Stripe(sk, { apiVersion: "2025-12-15.clover" as any });
    const repaired = await syncCompanyPlanExpiryFromStripe({
      companyRef,
      stripeSubscriptionId: subId,
      stripe,
    });
    if (repaired == null) {
      return NextResponse.json({ ok: true, planExpiryMs: null, backfilled: false, reason: "stripe_period_unavailable" });
    }
    return NextResponse.json({ ok: true, planExpiryMs: repaired, backfilled: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[repair-stripe-plan-expiry]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
