export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveIsCompanyFolderAccessible } from "@/lib/localCloudSync/server/driveTransportServer";

/** Shared device — Drive par company folder ab bhi hai ya nahi. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    driveFolderId?: string;
  };
  const companyId = String(body.companyId || "").trim();
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  const driveFolderId = typeof body.driveFolderId === "string" ? body.driveFolderId.trim() : undefined;
  if (!companyId && !driveFolderId) {
    return NextResponse.json({ error: "companyId or driveFolderId required" }, { status: 400 });
  }
  try {
    const accessible = await driveIsCompanyFolderAccessible(auth.uid, {
      companyId,
      companyName,
      driveFolderId,
    });
    return NextResponse.json({ accessible });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
