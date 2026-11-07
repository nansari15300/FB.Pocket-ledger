export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveRevokeCompanyFolderShare } from "@/lib/localCloudSync/server/driveTransportServer";

/** Company folder se Gmail share revoke. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as { companyId?: string; companyName?: string; email?: string };
  const companyId = String(body.companyId || "").trim();
  const email = String(body.email || "").trim();
  if (!companyId || !email) {
    return NextResponse.json({ error: "companyId and email required" }, { status: 400 });
  }
  try {
    const removed = await driveRevokeCompanyFolderShare(
      auth.uid,
      companyId,
      typeof body.companyName === "string" ? body.companyName.trim() : undefined,
      email
    );
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
