export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { buildGoogleDriveAuthUrl, type DriveOAuthState } from "@/lib/localCloudSync/server/driveOAuthServer";
import { driveHostedApiJson, driveHostedApiOptions } from "@/lib/server/driveHostedApiCors";
import { ensureHostingConfig } from "@/lib/server/hostingConfig";

/** APK/static localhost — CORS preflight (production middleware deploy se pehle bhi chale). */
export async function OPTIONS(req: NextRequest) {
  return driveHostedApiOptions(req);
}

/** Client-safe Drive connect — OAuth URL sirf server par `googleapis` se. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return driveHostedApiJson(req, { error: auth.error }, auth.status);
  }

  const body = (await req.json()) as DriveOAuthState;
  const returnPath = String(body.returnPath || "/company").trim();
  const uid = String(body.uid || auth.uid).trim();
  if (uid !== auth.uid) {
    return driveHostedApiJson(req, { error: "uid mismatch" }, 403);
  }

  try {
    await ensureHostingConfig(); // panel "Hosting settings" values (env vars still win)
    const url = buildGoogleDriveAuthUrl({
      returnPath,
      uid,
      email: body.email,
      formData: body.formData,
    });
    return driveHostedApiJson(req, { url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return driveHostedApiJson(req, { error: msg }, 500);
  }
}
