export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { resolveGoogleOAuthRedirectUri } from "@/lib/server/googleOAuthCredentials";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveHostedApiJson, driveHostedApiOptions } from "@/lib/server/driveHostedApiCors";
import { ensureHostingConfig, hostingLinked, hostingSource } from "@/lib/server/hostingConfig";

export async function OPTIONS(req: NextRequest) {
  return driveHostedApiOptions(req);
}

/** Public-safe payload builder: sirf true/false + callback preview (koi secret value expose nahi). */
function buildSafeEnvDiagnostics() {
  // Sirf boolean/safe fields return karo taaki production me env injection quickly verify ho jaaye.
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  const hasClientId = Boolean(String(process.env.GOOGLE_CLIENT_ID || "").trim());
  // Server fallback path: GOOGLE_CLIENT_ID blank ho to NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID use kiya ja sakta hai.
  const hasWebClientId = Boolean(String(process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID || "").trim());
  const hasClientSecret = Boolean(String(process.env.GOOGLE_CLIENT_SECRET || "").trim());
  const hasFirebaseProjectId = Boolean(String(process.env.FIREBASE_PROJECT_ID || "").trim());

  return {
    ok: true,
    env_present: {
      GOOGLE_CLIENT_ID: hasClientId,
      NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID: hasWebClientId,
      GOOGLE_CLIENT_SECRET: hasClientSecret,
      FIREBASE_PROJECT_ID: hasFirebaseProjectId,
      NEXT_PUBLIC_APP_URL: Boolean(appUrl),
    },
    // Effective server client id source visible rahe, taaki env fallback se rollout verify ho sake.
    effective_google_oauth_client_id_present: hasClientId || hasWebClientId,
    // Callback preview se Google Console redirect URI match turant compare ho sake.
    oauth_callback_preview: resolveGoogleOAuthRedirectUri(),
    // env var > server panel "Hosting settings" > none (sources only, never values)
    hosting_linked: hostingLinked(),
    effective_source: {
      google_client_id: hostingSource("google_client_id"),
      google_client_secret: hostingSource("google_client_secret"),
      drive_state_secret: hostingSource("drive_state_secret"),
      app_url: hostingSource("app_url"),
    },
  };
}

/** Browser-open quick check: deploy ke baad URL hit karke runtime env presence turant verify karo. */
export async function GET(req: NextRequest) {
  await ensureHostingConfig();
  return driveHostedApiJson(req, buildSafeEnvDiagnostics());
}

/** Authenticated check: app ke andar se same diagnostics payload consume karne ke liye. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return driveHostedApiJson(req, { error: auth.error }, auth.status);
  }
  await ensureHostingConfig();
  return driveHostedApiJson(req, buildSafeEnvDiagnostics());
}
