import { NextRequest, NextResponse } from "next/server";
import type admin from "@/lib/server/pbAdminTypes";

import { resolveBillingCaller } from "@/lib/server/billingCaller";

import { Timestamp } from "@/lib/server/pbBilling/fieldValue";
/**
 * Owner-only: push company.planExpiry forward by N calendar days (Firestore only).
 * Does not change Stripe subscription period — for manual grace / offline extensions.
 */
export async function POST(req: NextRequest) {
  try {
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status });
    }
    const decoded = billingCaller.decoded;

    const body = await req.json();
    const companyId = typeof body?.companyId === "string" ? body.companyId.trim() : "";
    const days = Math.min(3650, Math.max(1, Math.floor(Number(body?.days) || 0)));
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const db = billingCaller.db;
    const ref = db.collection("companies").doc(companyId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const data = snap.data() as { ownerId?: string; ownerEmail?: string };
    const ownerEmail = String(data.ownerEmail || "")
      .toLowerCase()
      .trim();
    const callerEmail = String(decoded.email || "")
      .toLowerCase()
      .trim();
    const isOwnerByUid = !!data.ownerId && data.ownerId === decoded.uid;
    const isOwnerByEmail = !!ownerEmail && !!callerEmail && ownerEmail === callerEmail;
    if (!isOwnerByUid && !isOwnerByEmail) {
      return NextResponse.json({ error: "Only the company owner can extend plan dates" }, { status: 403 });
    }

    const now = Date.now();
    const planExpRaw = snap.data()?.planExpiry as admin.firestore.Timestamp | undefined;
    const curExp = planExpRaw?.toMillis?.() ?? 0;
    const base = Math.max(now, curExp);
    const newExpMs = base + days * 86400000;

    await ref.update({
      planExpiry: Timestamp.fromMillis(newExpMs),
    });

    return NextResponse.json({ ok: true, planExpiryMs: newExpMs });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extend-plan-expiry]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
