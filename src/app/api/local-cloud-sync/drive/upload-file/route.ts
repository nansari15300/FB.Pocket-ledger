export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveUploadAttachmentFile } from "@/lib/localCloudSync/server/driveTransportServer";
import { buildPocketLedgerDriveRelativePath } from "@/lib/localCloudSync/pocketLedgerDrivePaths";

/** Voucher attachment bytes → `Pocket Ledger/{Company}/attachments/...`. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    driveSharedFolderId?: string;
    fileId?: string;
    remotePath?: string;
    sha256Hex?: string;
    contentType?: string;
    base64?: string;
  };
  const companyId = String(body.companyId || "").trim();
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  const driveSharedFolderId =
    typeof body.driveSharedFolderId === "string" ? body.driveSharedFolderId.trim() : undefined;
  const fileId = String(body.fileId || "").trim();
  const base64 = String(body.base64 || "");
  if (!companyId || !base64) {
    return NextResponse.json({ error: "companyId and base64 required" }, { status: 400 });
  }
  const remotePath =
    String(body.remotePath || "").trim() ||
    buildPocketLedgerDriveRelativePath({ companyId, companyName }, "attachments", "_files", fileId || "file");
  try {
    const res = await driveUploadAttachmentFile(
      auth.uid,
      remotePath,
      base64,
      body.contentType,
      body.sha256Hex,
      { companyId, companyName, driveSharedFolderId }
    );
    return NextResponse.json({ ok: true, remotePath: res.remotePath, deduped: res.deduped ?? false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
