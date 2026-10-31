export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyPocketBaseBearer } from "@/lib/localCloudSync/server/pbBearerAuth";
import { bearerFromRequest } from "@/lib/server/billingCaller";

/**
 * GET: hosted web `/app` access. The only login is the Pocket Ledger Server (`Bearer plpb.<token>`);
 * its accounts are created / approved by the server admin, so a valid, enabled account is allowed.
 */
export async function GET(req: NextRequest) {
  const token = bearerFromRequest(req);
  if (!token) {
    return NextResponse.json({ error: "Missing Authorization Bearer token", allowed: false }, { status: 401 });
  }
  const v = await verifyPocketBaseBearer(token);
  if ("error" in v) {
    return NextResponse.json({ error: v.error, allowed: false }, { status: v.status });
  }
  return NextResponse.json({ allowed: true, reason: "pl_server_account", email: v.email, uid: v.uid });
}