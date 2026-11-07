export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveShareCompanyFolder } from "@/lib/localCloudSync/server/driveTransportServer";

/** Company folder (`Pocket Ledger/{Company}/`) ko staff emails par writer share — app role registry me. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    emails?: string[];
    users?: Array<{ email: string; appRole?: string; role?: string }>;
  };
  const companyId = String(body.companyId || "").trim();
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  const users =
    Array.isArray(body.users) && body.users.length > 0
      ? body.users
      : Array.isArray(body.emails)
        ? body.emails
        : [];
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });
  try {
    const res = await driveShareCompanyFolder(auth.uid, companyId, companyName, users);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
