export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveGetManifest, driveUpdateManifest } from "@/lib/localCloudSync/server/driveTransportServer";
import type { CloudSyncManifest } from "@/lib/localCloudSync/types";

export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    driveSharedFolderId?: string;
    action?: "get" | "set";
    manifest?: CloudSyncManifest;
  };
  const companyId = String(body.companyId || "").trim();
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  const driveSharedFolderId =
    typeof body.driveSharedFolderId === "string" ? body.driveSharedFolderId.trim() : undefined;
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });
  try {
    if (body.action === "set" && body.manifest) {
      await driveUpdateManifest(auth.uid, companyId, body.manifest, companyName, driveSharedFolderId);
      return NextResponse.json({ ok: true });
    }
    const manifest = await driveGetManifest(auth.uid, companyId, companyName, driveSharedFolderId);
    return NextResponse.json(manifest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
