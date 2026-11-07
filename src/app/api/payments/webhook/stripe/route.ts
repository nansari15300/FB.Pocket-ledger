import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { billingDbForStore, billingStoreFromMeta } from "@/lib/server/billingCaller";
import * as admin from "firebase-admin";
import { normalizePlanIdForClient } from "@/config/plans";
import { grantAccountCanonicalPlan } from "@/lib/server/accountCanonicalPlan";
import {
  fulfillStripeCheckoutSessionCompleted,
  getStripeForPaymentsMerged,
  getSubscriptionWithPeriodEndRetry,
} from "@/lib/payments/stripeCheckoutFulfill";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!signature || !webhookSecret) {
    return NextResponse.json(
      { error: "Missing stripe-signature or STRIPE_WEBHOOK_SECRET" },
      { status: 400 }
    );
  }

  const stripe = await getStripeForPaymentsMerged();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Webhook error: ${message}` }, { status: 400 });
  }

  try {
    // `metadata.plStore === "server"` -> Pocket Ledger Server store; anything else -> Firestore (unchanged).
    const dbFor = (meta: Record<string, unknown> | null | undefined) => billingDbForStore(billingStoreFromMeta(meta));

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const db = dbFor(session.metadata);
      const result = await fulfillStripeCheckoutSessionCompleted(stripe, session, db);
      if (result.ok === false) {
        console.warn("[stripe webhook] checkout.session.completed failed", result.reason, session.id);
      }
      return NextResponse.json({ received: true });
    }

    // Subscription paid (pehli invoice + renewals): planExpiry — pehle subscription_create skip tha isliye 1st cycle par date nahi aati thi.
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const subRef = (invoice as { subscription?: string | { id?: string } | null }).subscription;
      const subId = typeof subRef === "string" ? subRef : subRef?.id;
      if (!subId) return NextResponse.json({ received: true });

      const period = await getSubscriptionWithPeriodEndRetry(stripe, subId);
      if (!period) return NextResponse.json({ received: true });
      const { subscription: sub, endMs } = period;
      const meta = sub.metadata || {};
      const db = dbFor(meta);
      const companyId = meta.companyId?.trim();
      const subscriptionUserId = meta.userId?.trim();
      if (!subscriptionUserId) return NextResponse.json({ received: true });

      const planExpiry = admin.firestore.Timestamp.fromMillis(endMs);
      const isFirstSubscriptionInvoice = invoice.billing_reason === "subscription_create";
      let accountOwnerUid = subscriptionUserId;
      if (companyId) {
        const companySnap = await db.collection("companies").doc(companyId).get();
        accountOwnerUid = String(companySnap.data()?.ownerId || subscriptionUserId).trim();
      }
      const userPlan = await db.collection("users").doc(accountOwnerUid).get();
      const planId = normalizePlanIdForClient(
        String(meta.planId || userPlan.data()?.accountCanonicalPlanId || "basic")
      );
      if (planId !== "basic") {
        await grantAccountCanonicalPlan(
          db,
          accountOwnerUid,
          {
            planId,
            planExpiryMs: endMs,
            planUpgradedAtMs: Date.now(),
            stripeCustomerId: typeof sub.customer === "string" ? sub.customer : null,
            stripeSubscriptionId: subId,
          },
          `stripe_invoice_paid:${invoice.id}`
        );
      }
      if (!companyId) return NextResponse.json({ received: true });

      await db.collection("companies").doc(companyId).update({
        planExpiry,
        planExpiryMs: endMs,
        stripeSubscriptionId: subId,
        // Successful charge — purana “renewal failed” banner hata do.
        billingAutoRenewFailureNoticeEn: admin.firestore.FieldValue.delete(),
        billingAutoRenewFailureNoticeUntilMs: admin.firestore.FieldValue.delete(),
        billingAutoRenewLastFailedInvoiceId: admin.firestore.FieldValue.delete(),
        // Renewal timestamp sirf actual renewals par — pehli invoice par nahi (misleading "renewal").
        ...(isFirstSubscriptionInvoice
          ? {}
          : { lastSubscriptionRenewalAt: admin.firestore.FieldValue.serverTimestamp() }),
      });

      return NextResponse.json({ received: true });
    }

    // Card decline + owner ne auto-renew off nahi kiya (`billingAutoRenew !== false`) → 3 din grace + billing alert.
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      // Stripe `Invoice.subscription` — SDK typing version drift par safe access.
      const subRef = (invoice as unknown as { subscription?: string | Stripe.Subscription | null }).subscription;
      const subId =
        typeof subRef === "string"
          ? subRef
          : subRef && typeof subRef === "object" && "id" in subRef
            ? (subRef as { id: string }).id
            : null;
      if (!subId) return NextResponse.json({ received: true });

      const sub = await stripe.subscriptions.retrieve(subId);
      const companyId = sub.metadata?.companyId?.trim();
      if (!companyId) return NextResponse.json({ received: true });
      const db = dbFor(sub.metadata);

      const coRef = db.collection("companies").doc(companyId);
      const coSnap = await coRef.get();
      if (!coSnap.exists) return NextResponse.json({ received: true });
      const cdata = coSnap.data() as Record<string, unknown>;

      // Explicit `false` = owner ne auto-renew band kiya — grace mat lagao; undefined/true = default / on.
      if (cdata.billingAutoRenew === false) {
        return NextResponse.json({ received: true });
      }

      // Pehli subscribe invoice fail alag flow — sirf recurring renewal / update fail par grace.
      const br = invoice.billing_reason;
      if (br !== "subscription_cycle" && br !== "subscription_update") {
        return NextResponse.json({ received: true });
      }

      const invId = typeof invoice.id === "string" ? invoice.id : "";
      if (invId && cdata.billingAutoRenewLastFailedInvoiceId === invId) {
        return NextResponse.json({ received: true });
      }

      const nowMs = Date.now();
      const MS_3D = 3 * 86400000;
      let curExp = 0;
      if (typeof cdata.planExpiryMs === "number" && Number.isFinite(cdata.planExpiryMs)) {
        curExp = cdata.planExpiryMs;
      } else {
        const pe = cdata.planExpiry as { toMillis?: () => number } | undefined;
        if (pe && typeof pe.toMillis === "function") curExp = pe.toMillis();
      }
      const base = Math.max(curExp, nowMs);
      const newExpMs = base + MS_3D;

      const noticeEn =
        "Renewal failed: insufficient balance on your saved card. You have 3 extra days to renew manually — after that, this company will move to the Basic (free) plan.";

      await coRef.update({
        planExpiryMs: newExpMs,
        planExpiry: admin.firestore.Timestamp.fromMillis(newExpMs),
        ...(invId ? { billingAutoRenewLastFailedInvoiceId: invId } : {}),
        billingAutoRenewLastFailureAt: admin.firestore.FieldValue.serverTimestamp(),
        billingAutoRenewFailureNoticeEn: noticeEn,
        billingAutoRenewFailureNoticeUntilMs: nowMs + MS_3D,
      });

      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true });
  } catch (e: unknown) {
    console.error("[stripe webhook] handler error", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
