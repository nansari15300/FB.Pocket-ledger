export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveUploadJsonAtRemotePath } from "@/lib/localCloudSync/server/driveTransportServer";

/** Opening JSON / encrypted file wrapper upload. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    driveSharedFolderId?: string;
    relativePath?: string;
    body?: string;
    contentType?: string;
  };
  const companyId = String(body.companyId || "").trim();
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  const driveSharedFolderId =
    typeof body.driveSharedFolderId === "string" ? body.driveSharedFolderId.trim() : undefined;
  const relativePath = String(body.relativePath || "").trim();
  const payload = String(body.body ?? "");
  if (!relativePath || !payload) {
    return NextResponse.json({ error: "relativePath and body required" }, { status: 400 });
  }
  try {
    const res = await driveUploadJsonAtRemotePath(
      auth.uid,
      relativePath,
      payload,
      body.contentType || "application/json",
      companyId ? { companyId, companyName, driveSharedFolderId } : undefined
    );
    return NextResponse.json({ ok: true, remotePath: res.remotePath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
