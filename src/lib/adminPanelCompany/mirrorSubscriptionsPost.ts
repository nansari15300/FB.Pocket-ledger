import { NextRequest, NextResponse } from "next/server";

import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";
import { replaySubscriptionMirrorsToAdminCompany } from "@/lib/adminPanelAccounting/replaySubscriptionMirrors";

import { verifyCompanyApiCallerByToken, type CompanyApiCaller } from "@/lib/server/companyApiCaller";
import { serverDb } from "@/lib/server/appDb";
async function requireSuperAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { error: "Missing Authorization Bearer token", status: 401 } as const;
  try {
    const decoded = await verifyCompanyApiCallerByToken(token);
    if (!(await isSuperAdminServer(decoded.uid, decoded.email ?? undefined))) {
      return { error: "SuperAdmin only", status: 403 } as const;
    }
    return { decoded } as const;
  } catch {
    return { error: "Invalid auth token", status: 401 } as const;
  }
}

export async function handleAdminPanelMirrorSubscriptionsPost(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = serverDb();
  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  if (!(await companyRef.get()).exists) {
    return NextResponse.json({ error: "Create Admin Panel Company first" }, { status: 409 });
  }

  let limit = 500;
  try {
    const body = (await req.json()) as { limit?: number };
    if (typeof body.limit === "number" && body.limit > 0) {
      limit = Math.min(500, Math.floor(body.limit));
    }
  } catch {
    // empty body ok
  }

  const result = await replaySubscriptionMirrorsToAdminCompany(db, { limit });
  return NextResponse.json({ ok: true, ...result });
}
