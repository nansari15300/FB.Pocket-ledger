import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_PLANS, type PlanId } from "@/config/plans";
import { findCountryWallet, parseCountryWallets } from "@/lib/countryWallets";
import { PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION, PENDING_SUBSCRIPTION_CHECKOUT_TTL_MS } from "@/lib/payments/pendingSubscriptionCheckout";
import { resolveBillingCaller } from "@/lib/server/billingCaller";
import { getEffectiveRegionalCheckout } from "@/lib/server/getEffectivePlanPrices";
import type { BillingRegionId } from "@/lib/billingRegions";
import { SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT, type SubscriptionTermKey } from "@/lib/subscriptionPlanMath";
import { Timestamp, serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

export async function POST(req: NextRequest) {
  try {
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status });
    }
    const body = (await req.json()) as {
      walletId?: string;
      planId?: string;
      companyId?: string;
      userId?: string;
      billingRegion?: BillingRegionId;
      subscriptionTermKey?: string;
    };
    const walletId = String(body.walletId || "").trim();
    const planId = String(body.planId || "").trim() as PlanId;
    const userId = String(billingCaller.decoded.uid || body.userId || "").trim();
    if (!walletId || !planId || !userId) {
      return NextResponse.json({ error: "walletId, planId, userId required" }, { status: 400 });
    }
    if (!DEFAULT_PLANS[planId] || DEFAULT_PLANS[planId].isFree) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    const termRaw = String(body.subscriptionTermKey || "year_1");
    const subscriptionTermKey: SubscriptionTermKey = SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT.has(
      termRaw as SubscriptionTermKey
    )
      ? (termRaw as SubscriptionTermKey)
      : "year_1";
    const billingRegion = (body.billingRegion === "saarc" || body.billingRegion === "international"
      ? body.billingRegion
      : "nepal") as BillingRegionId;

    const db = billingCaller.db;
    const snap = await db.doc("app_settings/payment_gateways").get();
    const wallets = parseCountryWallets(snap.exists ? (snap.data() as { wallets?: unknown }).wallets : []);
    const wallet = findCountryWallet(wallets, walletId);
    if (!wallet || !wallet.showOnPlan) {
      return NextResponse.json({ error: "Wallet is not available" }, { status: 403 });
    }

    const regional = await getEffectiveRegionalCheckout(planId, subscriptionTermKey, billingRegion);
    const pendingId = uuidv4();
    await db.collection(PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION).doc(pendingId).set({
      companyId: String(body.companyId || "").trim() || null,
      userId,
      planId,
      gateway: `wallet:${wallet.id}`,
      walletId: wallet.id,
      walletName: wallet.name,
      billingIntent: "subscribe",
      subscriptionTermKey,
      billingRegion,
      amountNpr: regional.amountMinor / 100,
      currency: regional.currency,
      status: "pending",
      expiresAt: Timestamp.fromMillis(Date.now() + PENDING_SUBSCRIPTION_CHECKOUT_TTL_MS),
      createdAt: serverTimestamp(),
    });

    const origin = new URL(req.url).origin;
    return NextResponse.json({
      gateway: "wallet",
      pendingId,
      engine: wallet.engine,
      walletName: wallet.name,
      merchant: wallet.merchant,
      instructions: wallet.instructions,
      amount: regional.amountMinor / 100,
      currency: regional.currency,
      autoConfirm: wallet.engine === "webhook",
      webhookUrl: `${origin}/api/payments/wallet-webhook`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
