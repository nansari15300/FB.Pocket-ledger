import { NextRequest, NextResponse } from "next/server";

import { isCompanyOwner } from "@/lib/server/companyOwner";
import { getStripeForPaymentsMerged } from "@/lib/payments/stripeCheckoutFulfill";
import { resolveBillingCaller } from "@/lib/server/billingCaller";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

type Body = {
  companyId?: string;
  /** true = Stripe `cancel_at_period_end: false` (agla cycle auto charge); false = period ke baad band, manual renew. */
  enabled?: boolean;
};

/**
 * Owner-only: Stripe subscription `cancel_at_period_end` + Firestore `billingAutoRenew` — checkbox billing page.
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
    const enabled = body.enabled === true;

    if (!companyId) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 });
    }

    const db = billingCaller.db;
    const companyRef = db.collection("companies").doc(companyId);
    const snap = await companyRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const cdata = snap.data() as {
      ownerId?: string;
      ownerEmail?: string;
      stripeSubscriptionId?: string;
    };
    if (!isCompanyOwner(decoded, cdata)) {
      return NextResponse.json({ error: "Only the company owner can change this setting" }, { status: 403 });
    }

    const subId =
      typeof cdata.stripeSubscriptionId === "string" ? cdata.stripeSubscriptionId.trim() : "";
    if (!subId) {
      return NextResponse.json(
        {
          error:
            "No Stripe subscription on this company. Use recurring Stripe checkout first; then auto renew can be toggled.",
        },
        { status: 400 }
      );
    }

    try {
      const stripe = await getStripeForPaymentsMerged();
      // false = agle renewal par auto charge; true = is period ke baad subscription khatam → owner manually "Continue — pay" se renew.
      await stripe.subscriptions.update(subId, { cancel_at_period_end: !enabled });
    } catch (se: unknown) {
      const sm = se instanceof Error ? se.message : String(se);
      console.error("[billing-auto-renew] Stripe subscriptions.update failed", se);
      return NextResponse.json({ error: `Stripe could not update subscription: ${sm}` }, { status: 502 });
    }

    await companyRef.update({
      billingAutoRenew: enabled,
      billingAutoRenewUpdatedAt: serverTimestamp(),
    });

    return NextResponse.json({ ok: true, billingAutoRenew: enabled });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[billing-auto-renew]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
