import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import { normalizePlanIdForClient } from "@/config/plans";
import { getEffectivePlanPrices } from "@/lib/server/getEffectivePlanPrices";
import { mirrorSubscriptionPaymentWithUserLookup } from "@/lib/adminPanelAccounting/mirrorSubscriptionPayment";
import { PAID_PLAN_IDS } from "@/lib/payments/stripeCheckoutFulfill";

const MS_YEAR = 365.25 * 24 * 60 * 60 * 1000;

type Body = {
  ownerId?: string;
  companyId?: string;
  /** After admin wrote planId on companies. */
  planId?: string;
  /** New expiry ms (admin date field). */
  planExpiryMs?: number | null;
  /** Previous expiry ms — used to price days added. */
  previousExpiryMs?: number | null;
  reason?: "admin_plan" | "admin_expiry";
};

/**
 * SuperAdmin Company Details: plan / expiry Firestore pe seedha likhta hai (no Stripe).
 * Is route se Admin Panel Company me subscriber party + sale/receipt mirror hota hai —
 * warna ProPlus dikhe, subscription account list / books khali rahein.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isFirebaseAdminConfigured()) {
      return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ error: "missing_token" }, { status: 401 });
    }

    getAdminDb();
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }

    const superOk = await isSuperAdminServer(decoded.uid, decoded.email ?? undefined);
    if (!superOk) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim() : "";
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    if (!ownerId || !companyId) {
      return NextResponse.json({ error: "ownerId_and_companyId_required" }, { status: 400 });
    }

    const db = getAdminDb();
    const companySnap = await db.collection("companies").doc(companyId).get();
    if (!companySnap.exists) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }
    const cdata = companySnap.data() as Record<string, unknown>;
    const planId = normalizePlanIdForClient(
      body.planId != null ? String(body.planId) : cdata.planId != null ? String(cdata.planId) : undefined
    );

    // Basic / free — party optional; no sale.
    if (!PAID_PLAN_IDS.has(planId)) {
      return NextResponse.json({ ok: true, skipped: "not_paid_plan", planId });
    }

    const nowMs = Date.now();
    const newExpiryMs =
      typeof body.planExpiryMs === "number" && Number.isFinite(body.planExpiryMs)
        ? body.planExpiryMs
        : typeof cdata.planExpiryMs === "number" && Number.isFinite(cdata.planExpiryMs)
          ? (cdata.planExpiryMs as number)
          : cdata.planExpiry &&
              typeof (cdata.planExpiry as { toMillis?: () => number }).toMillis === "function"
            ? (cdata.planExpiry as { toMillis: () => number }).toMillis()
            : null;

    const prevExpiryMs =
      typeof body.previousExpiryMs === "number" && Number.isFinite(body.previousExpiryMs)
        ? body.previousExpiryMs
        : null;

    const prices = await getEffectivePlanPrices(planId);
    const yearly = Math.max(0, Number(prices.yearly) || 0);

    let amountNpr = 0;
    const reason = body.reason === "admin_plan" ? "admin_plan" : "admin_expiry";
    if (reason === "admin_expiry" && newExpiryMs != null) {
      const base = Math.max(nowMs, prevExpiryMs ?? nowMs);
      const addedMs = Math.max(0, newExpiryMs - base);
      amountNpr = yearly > 0 ? Math.round((addedMs / MS_YEAR) * yearly * 100) / 100 : 0;
    } else if (reason === "admin_plan") {
      // Plan tier grant without a measured day delta — book one year list price (admin free grant).
      amountNpr = yearly;
    }

    // Always create/update subscriber party (mirror amount 0 still writes party).
    // Sale/receipt only when amount > 0.
    const paymentId = `admin_grant_${uuidv4()}`;
    const paymentRef = db.collection("companies").doc(companyId).collection("payments").doc(paymentId);
    await paymentRef.set({
      paymentId,
      userId: ownerId,
      planId,
      amount: Math.round(amountNpr * 100),
      currency: "npr",
      gateway: "admin_manual",
      status: amountNpr > 0 ? "completed" : "recorded",
      billingIntent: "admin_grant",
      planExpiryMs: newExpiryMs,
      adminGrantReason: reason,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: decoded.uid,
    });

    await mirrorSubscriptionPaymentWithUserLookup(db, {
      paymentId,
      userId: ownerId,
      amountNpr: Math.max(0, amountNpr),
      gateway: "admin_manual",
      planId,
      customerCompanyId: companyId,
      customerCompanyName: String(cdata.name ?? cdata.companyName ?? "").trim() || null,
      billingIntent: "admin_grant",
      subscriptionTermKey: reason,
    });

    return NextResponse.json({
      ok: true,
      paymentId,
      planId,
      amountNpr,
      mirroredSale: amountNpr > 0,
      note:
        amountNpr > 0
          ? "Admin Panel Company: subscriber + sale posted (admin_manual — no Stripe)."
          : "Admin Panel Company: subscriber party ensured; no sale (zero day delta / zero price).",
    });
  } catch (e) {
    console.error("[company-plan-grant-mirror]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
