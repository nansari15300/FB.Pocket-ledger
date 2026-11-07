export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveUploadOperation } from "@/lib/localCloudSync/server/driveTransportServer";
import type { LocalCloudSyncOperation } from "@/lib/localCloudSync/types";

export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    driveSharedFolderId?: string;
    op?: LocalCloudSyncOperation;
  };
  const companyId = String(body.companyId || "").trim();
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  const driveSharedFolderId =
    typeof body.driveSharedFolderId === "string" ? body.driveSharedFolderId.trim() : undefined;
  if (!companyId || !body.op) {
    return NextResponse.json({ error: "companyId and op required" }, { status: 400 });
  }
  try {
    await driveUploadOperation(auth.uid, body.op, companyName, driveSharedFolderId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
