import { NextRequest, NextResponse } from "next/server";
import type { PlanId } from "@/config/plans";
import { findCountryWallet, parseCountryWallets } from "@/lib/countryWallets";
import { PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION } from "@/lib/payments/pendingSubscriptionCheckout";
import { applyNewSubscriptionCheckoutToFirestore } from "@/lib/payments/subscriptionCheckoutApply";
import { serverDb } from "@/lib/server/appDb";
import type { SubscriptionTermKey } from "@/lib/subscriptionPlanMath";
import { SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT } from "@/lib/subscriptionPlanMath";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

/** Auto-confirm: Dubai (or any) gateway POSTs { pendingId, secret } after it is paid. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { pendingId?: string; secret?: string; id?: string };
    const pendingId = String(body.pendingId || body.id || "").trim();
    const secret = String(body.secret || req.headers.get("x-wallet-secret") || "").trim();
    if (!pendingId || !secret) {
      return NextResponse.json({ error: "pendingId and secret required" }, { status: 400 });
    }
    const db = serverDb();
    const pendingRef = db.collection(PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION).doc(pendingId);
    const pendingSnap = await pendingRef.get();
    if (!pendingSnap.exists) return NextResponse.json({ error: "not found" }, { status: 404 });
    const p = pendingSnap.data()!;
    if (p.status !== "pending") {
      return NextResponse.json({ ok: true, already: true });
    }
    const gwSnap = await db.doc("app_settings/payment_gateways").get();
    const wallets = parseCountryWallets(gwSnap.exists ? (gwSnap.data() as { wallets?: unknown }).wallets : []);
    const wallet = findCountryWallet(wallets, String(p.walletId || ""));
    const want = wallet.secret || wallet.apiKey;
    if (!wallet || wallet.engine !== "webhook" || !want || want !== secret) {
      return NextResponse.json({ error: "bad secret" }, { status: 403 });
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
      gateway: `wallet:${wallet.id}`,
      amountNpr: Number(p.amountNpr) || 0,
      currency: String(p.currency ?? "npr"),
      planId: p.planId as PlanId,
      subscriptionTermKey,
      billingIntent: "subscribe",
    });
    if (applied.ok === false) {
      return NextResponse.json({ error: applied.reason }, { status: 400 });
    }
    await pendingRef.update({ status: "paid", paidAt: serverTimestamp() });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
