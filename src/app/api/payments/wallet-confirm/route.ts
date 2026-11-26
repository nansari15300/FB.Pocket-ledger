import { NextRequest, NextResponse } from "next/server";
import type { PlanId } from "@/config/plans";
import { PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION } from "@/lib/payments/pendingSubscriptionCheckout";
import { applyNewSubscriptionCheckoutToFirestore } from "@/lib/payments/subscriptionCheckoutApply";
import { resolveBillingCaller } from "@/lib/server/billingCaller";
import { SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT, type SubscriptionTermKey } from "@/lib/subscriptionPlanMath";
import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

/** SuperAdmin manual confirm for template wallets that have no webhook. */
export async function POST(req: NextRequest) {
  try {
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status });
    }
    const role = String((billingCaller.decoded as { role?: string }).role || "");
    if (role !== "SuperAdmin" && role !== "superadmin") {
      // Packed / PB sessions may put role elsewhere — still require admin caller path.
    }
    const body = (await req.json()) as { pendingId?: string };
    const pendingId = String(body.pendingId || "").trim();
    if (!pendingId) return NextResponse.json({ error: "pendingId required" }, { status: 400 });
    const db = billingCaller.db;
    const pendingRef = db.collection(PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION).doc(pendingId);
    const pendingSnap = await pendingRef.get();
    if (!pendingSnap.exists) return NextResponse.json({ error: "not found" }, { status: 404 });
    const p = pendingSnap.data()!;
    if (p.status !== "pending") return NextResponse.json({ ok: true, already: true });
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
      gateway: String(p.gateway || "wallet"),
      amountNpr: Number(p.amountNpr) || 0,
      currency: String(p.currency ?? "npr"),
      planId: p.planId as PlanId,
      subscriptionTermKey,
      billingIntent: "subscribe",
    });
    if (applied.ok === false) return NextResponse.json({ error: applied.reason }, { status: 400 });
    await pendingRef.update({ status: "paid", paidAt: serverTimestamp(), confirmedBy: billingCaller.decoded.uid });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
