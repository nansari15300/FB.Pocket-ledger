export const runtime = "nodejs";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { doc, getDoc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";

type DecodedState = {
  returnPath?: string;
  formData?: any;
  uid?: string;
  email?: string;
};

function safeBase64JsonDecode<T = any>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error"); // user cancelled etc.

  const protocol = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host");
  const baseUrl = `${protocol}://${host}`;

  let returnPath = "/company";
  const encodedState = state || "";
  const decoded: DecodedState | null = state ? safeBase64JsonDecode(state) : null;

  if (decoded?.returnPath) returnPath = decoded.returnPath;

  // If user denied / cancelled
  if (oauthError) {
    const errorUrl = new URL(returnPath, baseUrl);
    errorUrl.searchParams.set("error", oauthError);
    if (encodedState) errorUrl.searchParams.set("state", encodedState);
    return NextResponse.redirect(errorUrl);
  }

  if (!code) {
    const errorUrl = new URL(returnPath, baseUrl);
    errorUrl.searchParams.set("error", "oauth_failed_no_code");
    if (encodedState) errorUrl.searchParams.set("state", encodedState);
    return NextResponse.redirect(errorUrl);
  }

  // ✅ IMPORTANT: state बाट uid आउनै पर्छ (CreateCompanyForm ले पठाइरहेको छ)
  const uid = decoded?.uid;
  if (!uid) {
    const errorUrl = new URL(returnPath, baseUrl);
    errorUrl.searchParams.set("error", "missing_uid_in_state");
    if (encodedState) errorUrl.searchParams.set("state", encodedState);
    return NextResponse.redirect(errorUrl);
  }

  try {
    const redirectUri = `${baseUrl}/api/auth/callback/google`;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri
    );

    // Exchange code -> tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error("No access_token received from Google.");
    }

    // ✅ If refresh_token not returned, reuse existing saved refreshToken
    const tokenDocRef = doc(firestore, "user_tokens", uid, "google", "drive");
    const existingSnap = await getDoc(tokenDocRef);
    const existing = existingSnap.exists() ? (existingSnap.data() as any) : {};

    const refreshToken = tokens.refresh_token || existing.refreshToken || null;

    await setDoc(
      tokenDocRef,
      {
        accessToken: tokens.access_token,
        refreshToken,
        expiryDate: tokens.expiry_date || null,
        scope: tokens.scope || null,
        tokenType: tokens.token_type || null,
        connectedEmail: decoded?.email || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // ✅ Redirect back with success + same state so UI shows "Connected"
    const successUrl = new URL(returnPath, baseUrl);
    successUrl.searchParams.set("success", "drive_connected");
    if (encodedState) successUrl.searchParams.set("state", encodedState);

    return NextResponse.redirect(successUrl);
  } catch (error: any) {
    // 🔴 DEBUG: exact reason why token exchange failed
    console.error("OAuth exchange failed FULL:", error);
    console.error(
      "OAuth exchange failed RESPONSE:",
      error?.response?.data || "no response data"
    );

    const errorUrl = new URL(returnPath, baseUrl);
    errorUrl.searchParams.set("error", "oauth_exchange_failed");
    if (encodedState) errorUrl.searchParams.set("state", encodedState);

    return NextResponse.redirect(errorUrl);
  }
}