export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import {
  driveDownloadFileAtCompanyPath,
  driveDownloadFileByRemotePath,
} from "@/lib/localCloudSync/server/driveTransportServer";

/** `drive:` full path ya company branch-relative path se bytes download. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    driveSharedFolderId?: string;
    /** Company folder ke andar — e.g. `opening/users/users.json` (shared join). */
    branchRelativePath?: string;
    /** Poora Pocket Ledger path — attachments / legacy. */
    remotePath?: string;
  };

  try {
    const branchRelativePath = String(body.branchRelativePath || "").trim();
    const companyId = String(body.companyId || "").trim();
    if (branchRelativePath && companyId) {
      const file = await driveDownloadFileAtCompanyPath(
        auth.uid,
        companyId,
        body.companyName,
        body.driveSharedFolderId,
        branchRelativePath
      );
      if (!file) return NextResponse.json({ base64: null, contentType: null });
      return NextResponse.json({ base64: file.base64, contentType: file.contentType });
    }

    const remotePath = String(body.remotePath || "").trim();
    if (!remotePath) {
      return NextResponse.json({ error: "remotePath or branchRelativePath required" }, { status: 400 });
    }
    const file = await driveDownloadFileByRemotePath(auth.uid, remotePath);
    if (!file) return NextResponse.json({ base64: null, contentType: null });
    return NextResponse.json({ base64: file.base64, contentType: file.contentType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
