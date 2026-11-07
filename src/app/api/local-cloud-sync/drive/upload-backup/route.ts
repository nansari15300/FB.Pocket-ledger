export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveUploadBackupFile } from "@/lib/localCloudSync/server/driveTransportServer";

/** Local backup `.plbp` → `Pocket Ledger/{Company}/backup/` (+ latest.plbp). */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json()) as {
    companyId?: string;
    companyName?: string;
    fileName?: string;
    base64?: string;
  };
  const companyId = String(body.companyId || "").trim();
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  const fileName = String(body.fileName || "").trim();
  const base64 = String(body.base64 || "");
  if (!companyId || !base64) {
    return NextResponse.json({ error: "companyId and base64 required" }, { status: 400 });
  }
  try {
    const res = await driveUploadBackupFile(auth.uid, companyId, companyName, fileName, base64);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
