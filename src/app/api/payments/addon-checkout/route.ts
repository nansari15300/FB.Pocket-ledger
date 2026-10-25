import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import admin from "firebase-admin";
import {
  getEsewaEpayV2FormUrl,
  isBillingGatewayAvailable,
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { optionalServerBillingCaller } from "@/lib/server/billingCaller";
import { getPublicAppHrefForPaymentRedirects } from "@/lib/checkoutPublicOrigin";
import {
  PENDING_ADDON_PURCHASES_COLLECTION,
  PENDING_ADDON_PURCHASE_TTL_MS,
} from "@/lib/payments/addonCheckoutApply";
import {
  addonKindLabel,
  normalizeAddonKind,
  readDeviceUserAddOnOfferFromPlansDoc,
  sanitizeDeviceUserAddOnOffer,
  unitPriceForAddonKind,
  type AddonKind,
} from "@/lib/planAddOns";
import { mergeAppSettingsPlansDoc } from "@/lib/mergeAppSettingsPlans";
import { planAllowsFirebaseOnline } from "@/lib/planSyncEntitlements";
import { resolveOwnerActivePaidSubscription } from "@/lib/server/resolveOwnerSubscriptionBilling";

type BodyItem = { kind?: AddonKind | string; quantity?: number };

type Body = {
  gateway?: "stripe" | "khalti" | "esewa";
  userId?: string;
  companyId?: string;
  kind?: AddonKind | string;
  quantity?: number;
  items?: BodyItem[];
};

async function getGatewayKeysFromAdmin(): Promise<GatewayKeys> {
  try {
    const db = getAdminDb();
    const snap = await db.doc("app_settings/payment_gateways").get();
    return (snap.exists ? (snap.data() as GatewayKeys) : {}) as GatewayKeys;
  } catch {
    return {};
  }
}

function parseCheckoutItems(body: Body): { kind: AddonKind; quantity: number }[] {
  const raw: BodyItem[] =
    Array.isArray(body.items) && body.items.length > 0
      ? body.items
      : body.kind != null
        ? [{ kind: body.kind, quantity: body.quantity ?? 1 }]
        : [];
  const merged = new Map<AddonKind, number>();
  for (const row of raw) {
    const kind = normalizeAddonKind(row.kind);
    const quantity = Math.max(0, Math.min(20, Math.floor(Number(row.quantity) || 0)));
    if (quantity <= 0) continue;
    merged.set(kind, (merged.get(kind) || 0) + quantity);
  }
  return [...merged.entries()].map(([kind, quantity]) => ({ kind, quantity }));
}

/**
 * Buy extra device/user slots (online or local) for the current subscription period (owner only).
 * Stripe / Khalti / eSewa — one checkout can include both device + user quantities.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const userId = String(body.userId || "").trim();
    const companyId = String(body.companyId || "").trim();
    const items = parseCheckoutItems(body);
    const gateway = body.gateway === "khalti" || body.gateway === "esewa" ? body.gateway : "stripe";

    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json(
        { error: "Enter quantity for device, user, and/or company slot" },
        { status: 400 }
      );
    }

    // Pocket Ledger Server login: `Bearer plpb.` -> server store + `plStore` on Stripe metadata.
    const serverCaller = await optionalServerBillingCaller(req);
    if (serverCaller && !serverCaller.ok) {
      return NextResponse.json({ error: serverCaller.error }, { status: serverCaller.status });
    }
    if (serverCaller && serverCaller.decoded.uid !== userId) {
      return NextResponse.json({ error: "userId does not match the signed-in account" }, { status: 403 });
    }
    const db = serverCaller ? serverCaller.db : getAdminDb();
    const sub = await resolveOwnerActivePaidSubscription(db, userId, companyId || null);
    if (sub.ok === false) {
      return NextResponse.json({ error: sub.error }, { status: sub.status });
    }
    const { planId: accountPlanId, expiryMs, paymentCompanyId } = sub.subscription;
    const effectiveCompanyId = paymentCompanyId || companyId || "";

    const plansSnap = await db.doc("app_settings/plans").get();
    const plansRaw = plansSnap.exists ? (plansSnap.data() as Record<string, unknown>) : undefined;
    const accountPlan = mergeAppSettingsPlansDoc(plansRaw).find((plan) => plan.id === accountPlanId);
    const containsOnlineAddOn = items.some((item) => item.kind.endsWith("-online"));
    if (containsOnlineAddOn && !planAllowsFirebaseOnline(accountPlanId, accountPlan)) {
      return NextResponse.json(
        {
          error:
            "Online add-ons require a plan that includes an online company. Upgrade your plan before buying online add-ons.",
        },
        { status: 400 }
      );
    }
    const offer = sanitizeDeviceUserAddOnOffer(
      readDeviceUserAddOnOfferFromPlansDoc(
        plansRaw ?? null
      )
    );
    if (!offer.enabled) {
      return NextResponse.json({ error: "Add-on service is disabled" }, { status: 400 });
    }

    let amountNpr = 0;
    const labelParts: string[] = [];
    for (const { kind, quantity } of items) {
      const unit = unitPriceForAddonKind(offer, kind);
      if (unit <= 0) {
        return NextResponse.json({ error: `Add-on price not configured for ${kind}` }, { status: 400 });
      }
      amountNpr += unit * quantity;
      labelParts.push(`${quantity} ${addonKindLabel(kind, quantity)}`);
    }
    if (amountNpr <= 0) {
      return NextResponse.json({ error: "Total amount must be greater than zero" }, { status: 400 });
    }
    const amountMinor = Math.round(amountNpr * 100);
    const productName = `Add-on: ${labelParts.join(" + ")}`;
    const addonItemsPacked = items.map((i) => `${i.kind}:${i.quantity}`).join(",");

    const flagsSnap = await db.doc("app_settings/payment_gateways").get();
    const flagsRaw = flagsSnap.exists ? (flagsSnap.data() as Record<string, unknown>) : null;
    const flags = parseGatewayPaymentFlags(flagsRaw);
    const stored = await getGatewayKeysFromAdmin();
    const keys = mergeGatewayKeysWithEnv(stored);

    if (!isBillingGatewayAvailable(gateway, keys, flags)) {
      return NextResponse.json(
        { error: `${gateway} payments are disabled or not configured.` },
        { status: 400 }
      );
    }

    if (gateway === "khalti" || gateway === "esewa") {
      const pendingId = uuidv4();
      const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_ADDON_PURCHASE_TTL_MS);
      const pendingRef = db.collection(PENDING_ADDON_PURCHASES_COLLECTION).doc(pendingId);
      await pendingRef.set({
        companyId: effectiveCompanyId || null,
        userId,
        items,
        addonItemsPacked,
        amountNpr,
        gateway,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt,
      });

      if (gateway === "khalti") {
        if (!keys.khaltiPublicKey) {
          await pendingRef.delete().catch(() => {});
          return NextResponse.json({ error: "Khalti is not configured (public key)." }, { status: 400 });
        }
        return NextResponse.json({
          gateway: "khalti" as const,
          pendingId,
          publicKey: keys.khaltiPublicKey,
          amount: amountMinor,
          product_identity: pendingId,
          product_name: productName,
          returnUrl: getPublicAppHrefForPaymentRedirects(
            req,
            `/billing/addon/khalti?pendingId=${encodeURIComponent(pendingId)}`
          ),
        });
      }

      if (!keys.esewaMerchantCode || !keys.esewaSecretKey) {
        await pendingRef.delete().catch(() => {});
        return NextResponse.json({ error: "eSewa is not configured (merchant code + secret)." }, { status: 400 });
      }
      const product_code = keys.esewaMerchantCode;
      const message = `total_amount=${amountNpr},transaction_uuid=${pendingId},product_code=${product_code}`;
      const signature = crypto.createHmac("sha256", keys.esewaSecretKey).update(message).digest("base64");
      return NextResponse.json({
        gateway: "esewa" as const,
        pendingId,
        url: getEsewaEpayV2FormUrl(product_code),
        amount: amountNpr,
        oid: pendingId,
        successUrl: getPublicAppHrefForPaymentRedirects(req, "/billing/addon/esewa"),
        failUrl: getPublicAppHrefForPaymentRedirects(req, "/billing?addon=cancel"),
        merchantCode: product_code,
        signature,
        signedFieldNames: "total_amount,transaction_uuid,product_code",
      });
    }

    const secret = keys.stripeSecretKey?.trim();
    if (!secret) {
      return NextResponse.json({ error: "Stripe is not configured" }, { status: 400 });
    }

    const stripe = new Stripe(secret, { apiVersion: "2025-12-15.clover" as any });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "npr",
            unit_amount: amountMinor,
            product_data: {
              name: productName,
              description: `Valid until current plan expiry`,
            },
          },
        },
      ],
      success_url: getPublicAppHrefForPaymentRedirects(req, "/billing?addon=success"),
      cancel_url: getPublicAppHrefForPaymentRedirects(req, "/billing?addon=cancel"),
      metadata: {
        addonPurchase: "true",
        addonItems: addonItemsPacked,
        addonKind: items[0].kind,
        addonQuantity: String(items[0].quantity),
        companyId: effectiveCompanyId || userId,
        userId,
        billingIntent: "addon_bundle",
        amountNpr: String(amountNpr),
        ...(serverCaller ? { plStore: "server" } : {}),
      },
    });

    return NextResponse.json({ url: session.url, sessionId: session.id, gateway: "stripe" as const });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[payments/addon-checkout]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
