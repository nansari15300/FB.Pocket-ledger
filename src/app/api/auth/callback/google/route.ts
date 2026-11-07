export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuth2Client, resolveGoogleOAuthRedirectUri } from "@/lib/server/googleOAuthCredentials";
import { ensureHostingConfig } from "@/lib/server/hostingConfig";
import { saveGoogleDriveTokensForUser, verifyDriveOAuthState } from "@/lib/localCloudSync/server/driveOAuthServer";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";

type DecodedState = {
  returnPath?: string;
  formData?: unknown;
  uid?: string;
  email?: string;
};

function safeBase64JsonDecode<T = unknown>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function redirectToReturnPath(returnPath: string, baseUrl: string, params: Record<string, string>, encodedState: string) {
  const target = new URL(returnPath, baseUrl);
  for (const [key, val] of Object.entries(params)) {
    target.searchParams.set(key, val);
  }
  if (encodedState) target.searchParams.set("state", encodedState);
  return NextResponse.redirect(target);
}

export async function GET(req: NextRequest) {
  await ensureHostingConfig(); // panel "Hosting settings" values (env vars still win)
  const url = req.nextUrl;

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const protocol = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host");
  const baseUrl = `${protocol}://${host}`;

  let returnPath = "/company";
  const encodedState = state || "";
  const decoded: DecodedState | null = state ? safeBase64JsonDecode(state) : null;

  const stateOk = verifyDriveOAuthState(decoded);
  // Unsigned / expired state: never follow its return address.
  if (stateOk && decoded?.returnPath) returnPath = decoded.returnPath;

  if (isLocalGoogleDriveSyncDisabled()) {
    return redirectToReturnPath(returnPath, baseUrl, { error: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE }, encodedState);
  }

  if (oauthError) {
    return redirectToReturnPath(returnPath, baseUrl, { error: oauthError }, encodedState);
  }

  if (!code) {
    return redirectToReturnPath(returnPath, baseUrl, { error: "oauth_failed_no_code" }, encodedState);
  }

  const uid = decoded?.uid;
  if (!uid) {
    return redirectToReturnPath(returnPath, baseUrl, { error: "missing_uid_in_state" }, encodedState);
  }
  // Only a state this server signed (Drive connect started by this uid, not older than 30 min).
  if (!stateOk) {
    return redirectToReturnPath("/company", baseUrl, { error: "invalid_oauth_state" }, "");
  }

  try {
    const redirectUri = resolveGoogleOAuthRedirectUri();
    const oauth2Client = createGoogleOAuth2Client(google, redirectUri);

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error("No access_token received from Google.");
    }

    await saveGoogleDriveTokensForUser(uid, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiryDate: tokens.expiry_date ?? null,
      scope: tokens.scope ?? null,
      tokenType: tokens.token_type ?? null,
      connectedEmail: decoded?.email ?? null,
    });

    return redirectToReturnPath(returnPath, baseUrl, { success: "drive_connected" }, encodedState);
  } catch (error: unknown) {
    console.error("OAuth exchange failed FULL:", error);
    const err = error as { response?: { data?: { error?: string; error_description?: string } } };
    console.error("OAuth exchange failed RESPONSE:", err?.response?.data || "no response data");

    const googleError = String(err?.response?.data?.error || "").trim() || "oauth_exchange_failed";
    return redirectToReturnPath(returnPath, baseUrl, { error: googleError }, encodedState);
  }
}
