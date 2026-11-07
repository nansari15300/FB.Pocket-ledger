export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { getGoogleDriveConnectionStatus } from "@/lib/localCloudSync/server/driveOAuthServer";
import { driveHostedApiJson, driveHostedApiOptions } from "@/lib/server/driveHostedApiCors";

export async function OPTIONS(req: NextRequest) {
  return driveHostedApiOptions(req);
}

export async function GET(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return driveHostedApiJson(req, { error: auth.error }, auth.status);
  }
  const status = await getGoogleDriveConnectionStatus(auth.uid);
  return driveHostedApiJson(req, status);
}
