export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveUploadAutoBackupFile } from "@/lib/localCloudSync/server/driveTransportServer";
import { driveHostedApiJson, driveHostedApiOptions } from "@/lib/server/driveHostedApiCors";

/** Auto backup `.plbp` → user-chosen Drive main folder (ledger cloud sync alag). */
export async function OPTIONS(req: NextRequest) {
  return driveHostedApiOptions(req);
}

export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return driveHostedApiJson(req, { error: auth.error }, auth.status);
  }
  const body = (await req.json()) as {
    mainFolderName?: string;
    companyFolderName?: string;
    relativeDir?: string;
    fileName?: string;
    base64?: string;
    keepPerCompany?: number;
  };
  const base64 = String(body.base64 || "");
  const fileName = String(body.fileName || "").trim();
  if (!base64 || !fileName) {
    return driveHostedApiJson(req, { error: "fileName and base64 required" }, 400);
  }
  try {
    const res = await driveUploadAutoBackupFile(auth.uid, {
      mainFolderName: String(body.mainFolderName || "Pocket Ledger Backups"),
      companyFolderName: String(body.companyFolderName || "company"),
      relativeDir: String(body.relativeDir || ""),
      fileName,
      base64,
      keepPerCompany: Number(body.keepPerCompany) || 30,
    });
    return driveHostedApiJson(req, { ok: true, ...res });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return driveHostedApiJson(req, { error: msg }, 500);
  }
}
