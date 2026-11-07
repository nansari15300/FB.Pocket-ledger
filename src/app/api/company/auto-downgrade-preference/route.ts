import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { resolveBillingCaller } from "@/lib/server/billingCaller";
import { isCompanyOwner } from "@/lib/server/companyOwner";

type Body = {
  companyId?: string;
  /** Expire ke baad renew na ho to Basic — `false` = server auto-downgrade band (sirf owner). */
  autoDowngradeToBasicWhenExpired?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveBillingCaller(req);
    if (caller.ok === false) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }
    const decoded = caller.decoded;

    const body = (await req.json()) as Body;
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    const raw = body.autoDowngradeToBasicWhenExpired;
    if (!companyId) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 });
    }
    if (typeof raw !== "boolean") {
      return NextResponse.json({ error: "autoDowngradeToBasicWhenExpired boolean required" }, { status: 400 });
    }

    const db = caller.db;
    const companyRef = db.collection("companies").doc(companyId);
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const cdata = companySnap.data() as { ownerId?: string; ownerEmail?: string };
    if (!isCompanyOwner(decoded, cdata)) {
      return NextResponse.json({ error: "Only the company owner can change this setting" }, { status: 403 });
    }

    await companyRef.update({
      autoDowngradeToBasicWhenExpired: raw,
      autoDowngradePreferenceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, autoDowngradeToBasicWhenExpired: raw });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auto-downgrade-preference]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
