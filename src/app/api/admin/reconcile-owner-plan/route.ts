import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { resolveSuperAdminCaller } from "@/lib/server/adminCaller";
import { reconcileOwnerCompaniesPlanWithDriftHeal } from "@/lib/server/accountCanonicalPlan";

type Body = { ownerId?: string };

/**
 * SuperAdmin: `users/{ownerId}` canonical plan + owned `companies` drift heal (Admin SDK).
 * Admin panel se plan batch ke baad client se call — `firebase-admin` browser par nahi chal sakta.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await resolveSuperAdminCaller(req);
    if (caller.ok === false) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim() : "";
    if (!ownerId) {
      return NextResponse.json({ error: "ownerId_required" }, { status: 400 });
    }

    const db = caller.db;
    const result = await reconcileOwnerCompaniesPlanWithDriftHeal(db, ownerId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[reconcile-owner-plan]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
