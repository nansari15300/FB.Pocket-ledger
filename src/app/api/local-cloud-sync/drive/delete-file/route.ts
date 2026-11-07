export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import {
  driveDeleteFileAtCompanyBranchPath,
  driveDeleteFileByRemotePath,
} from "@/lib/localCloudSync/server/driveTransportServer";

/** Drive attachment delete — company branch path (shared folder) ya full remote path. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    driveSharedFolderId?: string;
    branchRelativePath?: string;
    remotePath?: string;
  };
  const companyId = String(body.companyId || "").trim();
  const branchRelativePath = String(body.branchRelativePath || "").trim();
  const remotePath = String(body.remotePath || "").trim();
  if (!branchRelativePath && !remotePath) {
    return NextResponse.json({ error: "branchRelativePath or remotePath required" }, { status: 400 });
  }
  try {
    if (branchRelativePath && companyId) {
      const deleted = await driveDeleteFileAtCompanyBranchPath(auth.uid, {
        companyId,
        companyName: body.companyName,
        driveSharedFolderId: body.driveSharedFolderId,
      }, branchRelativePath);
      if (deleted) return NextResponse.json({ ok: true });
    }
    if (remotePath) {
      await driveDeleteFileByRemotePath(auth.uid, remotePath);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
