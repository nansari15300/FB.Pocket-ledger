import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import {
  applyAddonPurchaseToFirestore,
  PENDING_ADDON_PURCHASES_COLLECTION,
} from "@/lib/payments/addonCheckoutApply";
import {
  getKhaltiPaymentVerifyUrl,
  isBillingGatewayAvailable,
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  resolveKhaltiSecretKeyFromEnv,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import type { AddonKind } from "@/lib/planAddOns";
import { resolveBillingCaller } from "@/lib/server/billingCaller";

type Body = {
  pendingId?: string;
  token?: string;
  amount?: number;
};

export async function POST(req: NextRequest) {
  try {
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status });
    }
    const decoded = billingCaller.decoded;

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

    const pendingRef = db.collection(PENDING_ADDON_PURCHASES_COLLECTION).doc(pendingId);
    const pendingSnap = await pendingRef.get();
    if (!pendingSnap.exists) {
      return NextResponse.json({ error: "Pending checkout not found" }, { status: 404 });
    }

    const p = pendingSnap.data()!;
    if (p.status !== "pending") {
      return NextResponse.json({ error: "This checkout was already processed" }, { status: 409 });
    }
    if (p.userId !== decoded.uid) {
      return NextResponse.json({ error: "This payment belongs to another account" }, { status: 403 });
    }
    if (p.gateway !== "khalti") {
      return NextResponse.json({ error: "Not a Khalti pending checkout" }, { status: 400 });
    }

    const exp = p.expiresAt as admin.firestore.Timestamp;
    if (exp.toMillis() < Date.now()) {
      await pendingRef.update({ status: "cancelled" }).catch(() => {});
      return NextResponse.json({ error: "Checkout expired — start again from Billing." }, { status: 410 });
    }

    const amountNpr = Number(p.amountNpr);
    const expectedPaisa = Math.round(amountNpr * 100);
    if (!Number.isFinite(amountPaisa) || Math.abs(amountPaisa - expectedPaisa) > 2) {
      return NextResponse.json({ error: "Amount does not match quoted add-on total" }, { status: 400 });
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
      const vdata = (await verifyRes.json()) as { state?: string; detail?: string };
      if (!verifyRes.ok || vdata?.state !== "Completed") {
        return NextResponse.json(
          { error: typeof vdata?.detail === "string" ? vdata.detail : "Khalti verification failed" },
          { status: 402 }
        );
      }
    }

    const items = (Array.isArray(p.items) ? p.items : []) as { kind: AddonKind; quantity: number }[];
    const applied = await applyAddonPurchaseToFirestore({
      db,
      companyId: String(p.companyId),
      userId: String(p.userId),
      paymentId: khaltiToken,
      gateway: "khalti",
      amount: amountNpr,
      currency: "npr",
      items,
    });

    if (applied.ok === false) {
      return NextResponse.json({ error: applied.reason }, { status: 400 });
    }

    await pendingRef.update({
      status: "applied",
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-addon-khalti]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
