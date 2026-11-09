import { NextRequest, NextResponse } from "next/server";
import type admin from "@/lib/server/pbAdminTypes";

import {
  applyAddonPurchaseToFirestore,
  PENDING_ADDON_PURCHASES_COLLECTION,
} from "@/lib/payments/addonCheckoutApply";
import {
  isBillingGatewayAvailable,
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import type { AddonKind } from "@/lib/planAddOns";
import { resolveBillingCaller } from "@/lib/server/billingCaller";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

type Body = {
  decoded?: Record<string, unknown>;
};

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

    const pendingRef = db.collection(PENDING_ADDON_PURCHASES_COLLECTION).doc(transactionUuid);
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

    const amountNpr = Number(p.amountNpr);
    if (!Number.isFinite(totalNum) || Math.abs(totalNum - amountNpr) > 0.5) {
      return NextResponse.json({ error: "Amount does not match quoted add-on total" }, { status: 400 });
    }

    const items = (Array.isArray(p.items) ? p.items : []) as { kind: AddonKind; quantity: number }[];
    const applied = await applyAddonPurchaseToFirestore({
      db,
      companyId: String(p.companyId),
      userId: String(p.userId),
      paymentId: transactionUuid,
      gateway: "esewa",
      amount: amountNpr,
      currency: "npr",
      items,
    });

    if (applied.ok === false) {
      return NextResponse.json({ error: applied.reason }, { status: 400 });
    }

    await pendingRef.update({
      status: "applied",
      appliedAt: serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-addon-esewa]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
