import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { resolveSuperAdminCaller } from "@/lib/server/adminCaller";
import { syncOwnedCompaniesFromUserDocCanonicalPlan } from "@/lib/server/accountCanonicalPlan";

type Body = { ownerId?: string };

/**
 * SuperAdmin: pehle `users/{ownerId}` par `accountCanonical*` edit (console), phir yeh POST —
 * owned `companies` par wahi plan / expiry / Stripe mirror (har company doc manually na kholo).
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
    const result = await syncOwnedCompaniesFromUserDocCanonicalPlan(db, ownerId);
    if (result.ok === false) {
      if (result.reason === "user_not_found") {
        return NextResponse.json({ ok: false, reason: result.reason }, { status: 404 });
      }
      return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true, companiesPatched: result.companiesPatched });
  } catch (e) {
    console.error("[push-plan-from-user-to-companies]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
