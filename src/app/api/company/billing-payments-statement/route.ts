import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { isCompanyOwner } from "@/lib/server/companyOwner";
import { resolveBillingCaller } from "@/lib/server/billingCaller";

function createdAtMs(data: Record<string, unknown>): number {
  const c = data.createdAt as admin.firestore.Timestamp | undefined;
  if (c && typeof c.toMillis === "function") return c.toMillis();
  return 0;
}

/**
 * Owner-only: `companies/{id}/payments` — billing statement / history (client table).
 * `orderBy` index na ho to sab docs + memory sort (limit baad).
 */
export async function GET(req: NextRequest) {
  try {
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status });
    }
    const decoded = billingCaller.decoded;

    const companyId = req.nextUrl.searchParams.get("companyId")?.trim() ?? "";
    if (!companyId) {
      return NextResponse.json({ error: "companyId query required" }, { status: 400 });
    }

    const db = billingCaller.db;
    const companyRef = db.collection("companies").doc(companyId);
    const snap = await companyRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const cdata = snap.data() as { ownerId?: string; ownerEmail?: string; planId?: string; planExpiryMs?: number };
    if (!isCompanyOwner(decoded, cdata)) {
      return NextResponse.json({ error: "Only the company owner can view this statement" }, { status: 403 });
    }

    let payDocs: admin.firestore.QueryDocumentSnapshot[] = [];
    try {
      const q = await companyRef.collection("payments").orderBy("createdAt", "desc").limit(200).get();
      payDocs = q.docs;
    } catch {
      const all = await companyRef.collection("payments").limit(500).get();
      payDocs = all.docs.sort((a, b) => createdAtMs(b.data()) - createdAtMs(a.data())).slice(0, 200);
    }

    const payments = payDocs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const createdAt = data.createdAt as admin.firestore.Timestamp | undefined;
      const pe = data.planExpiryMs;
      const planExpiryMs = typeof pe === "number" && Number.isFinite(pe) ? pe : null;
      const hist = data.planChangeHistory;
      return {
        id: d.id,
        paymentId: typeof data.paymentId === "string" ? data.paymentId : d.id,
        userId: String(data.userId ?? ""),
        planId: String(data.planId ?? ""),
        amount: typeof data.amount === "number" ? data.amount : Number(data.amount ?? 0),
        currency: String(data.currency ?? "npr"),
        gateway: String(data.gateway ?? ""),
        status: String(data.status ?? ""),
        billingIntent: data.billingIntent != null ? String(data.billingIntent) : null,
        planChangeFrom: data.planChangeFrom != null ? String(data.planChangeFrom) : null,
        planChangeTo: data.planChangeTo != null ? String(data.planChangeTo) : null,
        planChangeOneTime: data.planChangeOneTime === true,
        planExpiryMs,
        createdAtMs: createdAt?.toMillis() ?? null,
        planChangeHistory:
          hist != null && typeof hist === "object" ? (hist as Record<string, unknown>) : null,
      };
    });

    const planExpiryMs =
      typeof cdata.planExpiryMs === "number" && Number.isFinite(cdata.planExpiryMs)
        ? cdata.planExpiryMs
        : null;

    return NextResponse.json({
      companyId,
      planId: cdata.planId != null ? String(cdata.planId) : null,
      planExpiryMs,
      payments,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[billing-payments-statement]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
