import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import {
  getEsewaEpayV2FormUrl,
  isBillingGatewayAvailable,
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  type BillingGatewayId,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { DEFAULT_PLANS, type PlanId } from "@/config/plans";
import { getEffectiveRegionalCheckout } from "@/lib/server/getEffectivePlanPrices";
import type { BillingRegionId } from "@/lib/billingRegions";
import { billingCurrencyToGatewayCode } from "@/lib/billingRegions";
import {
  SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT,
  type SubscriptionTermKey,
} from "@/lib/subscriptionPlanMath";
import { getPublicAppHrefForPaymentRedirects } from "@/lib/checkoutPublicOrigin";
import {
  PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION,
  PENDING_SUBSCRIPTION_CHECKOUT_TTL_MS,
} from "@/lib/payments/pendingSubscriptionCheckout";
import { optionalServerBillingCaller } from "@/lib/server/billingCaller";
type AdminKeysResult = {
  stored: GatewayKeys;
  adminReadOk: boolean;
  docExists: boolean;
  adminError?: string;
};

/** Server has no user auth — read Bank Settings doc with Admin SDK, then merge STRIPE_* / KHALTI_* from env. */
async function getGatewayKeysFromAdmin(): Promise<AdminKeysResult> {
  try {
    const db = getAdminDb();
    const snap = await db.doc("app_settings/payment_gateways").get();
    return {
      stored: (snap.exists ? (snap.data() as GatewayKeys) : {}) as GatewayKeys,
      adminReadOk: true,
      docExists: snap.exists,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[payments/initiate] Firebase Admin read failed — check FIREBASE_* in .env.local", e);
    return { stored: {}, adminReadOk: false, docExists: false, adminError: msg };
  }
}

function hasStripeInEnv(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_TEST_SECRET_KEY?.trim());
}

function stripeConfigHelpMessage(adminResult: AdminKeysResult): string {
  const envHint = hasStripeInEnv()
    ? "STRIPE_SECRET_KEY is set but empty after merge — restart dev/server after editing .env.local."
    : "Add STRIPE_SECRET_KEY=sk_test_… to .env.local (project root), then restart `npm run dev`.";

  if (!adminResult.adminReadOk) {
    return (
      `Stripe is not configured. Firebase Admin cannot read Bank Settings. ` +
      `Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env.local. ` +
      `(${adminResult.adminError || "unknown"}) ${envHint}`
    );
  }
  if (!adminResult.docExists) {
    return (
      `Stripe is not configured. Save Stripe Secret once in Admin → Bank Settings (creates app_settings/payment_gateways). ${envHint}`
    );
  }
  if (!adminResult.stored.stripeSecretKey?.trim()) {
    return (
      `Stripe is not configured. Bank Settings doc exists but Stripe Secret is empty — paste sk_test_… (not pk_test_), Save. ${envHint}`
    );
  }
  return `Stripe is not configured. ${envHint}`;
}

type Body = {
  planId: PlanId;
  gateway: "stripe" | "khalti" | "esewa";
  amount: number; // in smallest unit for gateway
  currency: string;
  userId: string;
  /** Optional legacy/display context. Subscription ownership is the user account. */
  companyId?: string;
  billingCycle: "monthly" | "yearly";
  /** When billingCycle is yearly: 1–10 (total term length for Stripe recurring / amount). */
  periodYears?: number;
  /** Full term (monthly … year_10 legacy); when set, drives Stripe `recurring` + server price check. */
  subscriptionTermKey?: string;
  /** Donations (free/basic) vs paid plan checkout — webhook uses this to skip plan upgrade. */
  billingIntent?: "donation" | "subscribe";
  /** User company country → Nepal / SAARC / International checkout amount. */
  billingRegion?: BillingRegionId;
};

// UI max 1 yr — purane `year_2`… keys ab bhi allow taaki pending Stripe sessions fail na hon.
const VALID_SUBSCRIPTION_TERM_KEYS = SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT;

/** Maps app term keys to Stripe `recurring` on Checkout `price_data` (subscription mode). */
function stripeRecurringFromTerm(termKey: SubscriptionTermKey): {
  interval: "month" | "year";
  interval_count: number;
} {
  if (termKey === "monthly") return { interval: "month", interval_count: 1 };
  if (termKey === "quarter") return { interval: "month", interval_count: 3 };
  if (termKey === "half_year") return { interval: "month", interval_count: 6 };
  const m = /^year_(\d+)$/.exec(termKey);
  const n = m != null ? Math.min(10, Math.max(1, parseInt(m[1], 10))) : 1;
  return { interval: "year", interval_count: n };
}

export async function POST(req: NextRequest) {
  try {
    const body: Body = await req.json();
    const { planId, gateway, amount, currency, userId, companyId, billingCycle, billingIntent } = body;
    const billingRegion: BillingRegionId =
      body.billingRegion === "saarc" || body.billingRegion === "international"
        ? body.billingRegion
        : "nepal";

    if (!userId?.trim()) {
      throw new Error("userId is required for checkout.");
    }
    const billingCompanyId = String(companyId || "").trim();

    // Pocket Ledger Server login: `Bearer plpb.` -> pending docs on the server store, `plStore` on Stripe metadata.
    const serverCaller = await optionalServerBillingCaller(req);
    if (serverCaller && !serverCaller.ok) {
      return NextResponse.json({ error: serverCaller.error }, { status: serverCaller.status });
    }
    if (serverCaller && serverCaller.decoded.uid !== userId.trim()) {
      return NextResponse.json({ error: "userId does not match the signed-in account" }, { status: 403 });
    }
    const storeMeta: Record<string, string> = serverCaller ? { plStore: "server" } : {};

    const intent = billingIntent ?? "subscribe";
    const periodYears =
      billingCycle === "yearly"
        ? Math.min(10, Math.max(1, Math.floor(Number(body.periodYears) || 1)))
        : 1;

    const rawTerm = typeof body.subscriptionTermKey === "string" ? body.subscriptionTermKey.trim() : "";
    const subscriptionTermKey: SubscriptionTermKey =
      rawTerm && VALID_SUBSCRIPTION_TERM_KEYS.has(rawTerm as SubscriptionTermKey)
        ? (rawTerm as SubscriptionTermKey)
        : billingCycle === "monthly"
          ? "monthly"
          : (`year_${periodYears}` as SubscriptionTermKey);

    // Paid subscribe: amount + currency server se (regional prices + FX) — client symbol-only change se mismatch na ho.
    let chargeMinor = Math.round(Number(amount) || 0);
    let checkoutCurrency = billingCurrencyToGatewayCode(currency || "npr");
    if (intent === "subscribe" && planId && !DEFAULT_PLANS[planId]?.isFree) {
      const regional = await getEffectiveRegionalCheckout(planId, subscriptionTermKey, billingRegion);
      chargeMinor = regional.amountMinor;
      checkoutCurrency = regional.currency;
    } else if (intent === "donation") {
      throw new Error("Donations are no longer supported.");
    }

    if (gateway === "khalti" || gateway === "esewa") {
      if (billingRegion !== "nepal" || checkoutCurrency !== "npr") {
        return NextResponse.json(
          {
            error: "Khalti and eSewa only support NPR (Nepal). Use Stripe for SAARC / International.",
            code: "gateway_currency_mismatch",
          },
          { status: 400 }
        );
      }
    }

    const db = serverCaller ? serverCaller.db : getAdminDb();
    const amountNpr = chargeMinor / 100;
    const adminResult = await getGatewayKeysFromAdmin();
    const keys = mergeGatewayKeysWithEnv(adminResult.stored);
    const paymentFlags = parseGatewayPaymentFlags(adminResult.stored as Record<string, unknown>);
    const gw: BillingGatewayId =
      gateway === "khalti" ? "khalti" : gateway === "esewa" ? "esewa" : "stripe";
    if (!isBillingGatewayAvailable(gw, keys, paymentFlags)) {
      return NextResponse.json(
        { error: "This payment method is disabled or not configured.", code: "gateway_disabled" },
        { status: 403 }
      );
    }

    if (gateway === "stripe") {
        if (!keys.stripeSecretKey) {
            throw new Error(stripeConfigHelpMessage(adminResult));
        }
        const stripe = new Stripe(keys.stripeSecretKey, { apiVersion: "2025-12-15.clover" as any });
        const recurring = stripeRecurringFromTerm(subscriptionTermKey);
        const productLabel = `Plan ${planId} (${subscriptionTermKey})`;
        // subscription_data.metadata is copied onto the Subscription so invoice.paid renewals can resolve companyId.
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "subscription",
            line_items: [
            {
                price_data: {
                currency: checkoutCurrency,
                product_data: { name: productLabel },
                unit_amount: chargeMinor,
                recurring,
                },
                quantity: 1,
            },
            ],
            success_url: getPublicAppHrefForPaymentRedirects(
              req,
              "/billing/success?session_id={CHECKOUT_SESSION_ID}"
            ),
            cancel_url: getPublicAppHrefForPaymentRedirects(req, "/billing/cancel"),
            metadata: {
              userId,
              planId,
              gateway,
              companyId: billingCompanyId,
              billingCycle,
              billingIntent: intent,
              periodYears: String(periodYears),
              subscriptionTermKey,
              ...storeMeta,
            },
            subscription_data: {
              metadata: {
                userId,
                companyId: billingCompanyId,
                planId,
                gateway,
                billingCycle,
                billingIntent: intent,
                periodYears: String(periodYears),
                subscriptionTermKey,
                ...storeMeta,
              },
            },
        });
        return NextResponse.json({ url: session.url });

    } else if (gateway === "khalti") {
        if (!keys.khaltiPublicKey) {
            throw new Error("Khalti is not configured.");
        }
        return NextResponse.json({
            gateway: "khalti",
            publicKey: keys.khaltiPublicKey,
            amount: chargeMinor,
            currency: checkoutCurrency,
            product_identity: planId,
            product_name: `Plan ${planId}`,
            returnUrl: getPublicAppHrefForPaymentRedirects(req, "/billing/khalti/success"),
            metadata: {
              userId,
              planId,
              companyId: billingCompanyId,
              billingCycle,
              billingIntent: intent,
              periodYears: String(periodYears),
              subscriptionTermKey,
            },
        });

    } else if (gateway === "esewa") {
        if (!keys.esewaMerchantCode || !keys.esewaSecretKey) {
            throw new Error("eSewa is not configured.");
        }
        const transaction_uuid = uuidv4();
        const product_code = keys.esewaMerchantCode;
        const total_amount_in_rupees = amountNpr;
        await db.collection(PENDING_SUBSCRIPTION_CHECKOUTS_COLLECTION).doc(transaction_uuid).set({
          companyId: billingCompanyId || null,
          userId: userId.trim(),
          planId,
          gateway: "esewa",
          billingIntent: intent,
          subscriptionTermKey,
          billingCycle,
          periodYears: String(periodYears),
          billingRegion,
          amountNpr,
          currency: checkoutCurrency,
          status: "pending",
          expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_SUBSCRIPTION_CHECKOUT_TTL_MS),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        const message_parts = [
            `total_amount=${total_amount_in_rupees}`,
            `transaction_uuid=${transaction_uuid}`,
            `product_code=${product_code}`
        ];
        const message = message_parts.join(',');
        
        const signature = crypto
            .createHmac('sha256', keys.esewaSecretKey)
            .update(message)
            .digest('base64');
            
        const eSewaUrl = getEsewaEpayV2FormUrl(product_code);
        
        return NextResponse.json({
            gateway: "esewa",
            url: eSewaUrl,
            amount: total_amount_in_rupees,
            oid: transaction_uuid,
            successUrl: getPublicAppHrefForPaymentRedirects(req, "/billing/esewa/success"),
            failUrl: getPublicAppHrefForPaymentRedirects(req, "/billing/cancel"),
            merchantCode: product_code,
            signature,
            signedFieldNames: "total_amount,transaction_uuid,product_code",
            metadata: {
              userId,
              planId,
              companyId: billingCompanyId || null,
              billingCycle,
              billingIntent: intent,
              periodYears: String(periodYears),
              subscriptionTermKey,
            },
        });
    }

    return NextResponse.json({ error: "Unsupported gateway" }, { status:  400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
