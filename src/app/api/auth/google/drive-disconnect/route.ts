export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { deleteGoogleDriveTokensForUser } from "@/lib/localCloudSync/server/driveOAuthServer";
import { driveHostedApiJson, driveHostedApiOptions } from "@/lib/server/driveHostedApiCors";

export async function OPTIONS(req: NextRequest) {
  return driveHostedApiOptions(req);
}

/** Client se Drive unlink — token doc sirf Admin SDK se (Firestore rules client delete allow nahi). */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return driveHostedApiJson(req, { error: auth.error }, auth.status);
  }
  try {
    await deleteGoogleDriveTokensForUser(auth.uid);
    return driveHostedApiJson(req, { ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return driveHostedApiJson(req, { error: msg }, 500);
  }
}
