import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import { listAdminSubscriptionPayments } from "@/lib/adminPanelAccounting/subscriptionPaymentsSource";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    getAdminDb();
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
    }

    const email = decoded.email ?? undefined;
    const ok = await isSuperAdminServer(decoded.uid, email);
    if (!ok) {
      return NextResponse.json({ error: "SuperAdmin only" }, { status: 403 });
    }

    const db = getAdminDb();
    const merged = await listAdminSubscriptionPayments(db, 500);

    const payments = merged.map((row) => ({
      id: row.paymentId,
      companyId: row.companyId,
      userId: row.userId,
      planId: row.planId,
      amount: row.amount,
      currency: row.currency,
      gateway: row.gateway,
      status: row.status,
      paymentId: row.paymentId,
      createdAtMs: row.createdAtMs,
      planExpiryMs: row.planExpiryMs,
      planChangeFrom: row.planChangeFrom,
      planChangeTo: row.planChangeTo,
      planChangeHistory: row.planChangeHistory,
    }));

    return NextResponse.json({ payments });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[subscription-payments]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
