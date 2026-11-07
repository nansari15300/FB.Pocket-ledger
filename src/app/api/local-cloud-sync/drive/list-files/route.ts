export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveListEncryptableFiles } from "@/lib/localCloudSync/server/driveTransportServer";

/** List attachment + opening files for force re-encrypt. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    driveSharedFolderId?: string;
  };
  const companyId = String(body.companyId || "").trim();
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });
  try {
    const files = await driveListEncryptableFiles(
      auth.uid,
      companyId,
      typeof body.companyName === "string" ? body.companyName.trim() : undefined,
      typeof body.driveSharedFolderId === "string" ? body.driveSharedFolderId.trim() : undefined
    );
    return NextResponse.json({ ok: true, files });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
