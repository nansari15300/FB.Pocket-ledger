import "server-only";

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { google } from "googleapis";
import { createGoogleOAuth2Client } from "@/lib/server/googleOAuthCredentials";
import { hostingSetting } from "@/lib/server/hostingConfig";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

export type DriveOAuthState = {
  returnPath: string;
  uid: string;
  email?: string;
  formData?: unknown;
};

/** OAuth `state` lifetime (sign-in at Google must finish within this). */
const DRIVE_OAUTH_STATE_MAX_AGE_MS = 30 * 60_000;

function driveOAuthStateKey(): Buffer {
  // env > server panel "Hosting settings" (ensureHostingConfig() is awaited by the routes)
  const own = hostingSetting("drive_state_secret");
  const base = own || hostingSetting("google_client_secret");
  if (!base) throw new Error("Drive OAuth state key missing (GOOGLE_CLIENT_SECRET / DRIVE_OAUTH_STATE_SECRET)");
  return createHash("sha256").update(`pl-drive-state:${base}`).digest();
}

function driveOAuthStateSig(s: { returnPath?: unknown; uid?: unknown; email?: unknown; formData?: unknown; iat?: unknown }): string {
  const payload = JSON.stringify([s.returnPath ?? null, s.uid ?? null, s.email ?? null, s.formData ?? null, s.iat ?? null]);
  return createHmac("sha256", driveOAuthStateKey()).update(payload).digest("base64url");
}

/**
 * OAuth callback: the state (uid the tokens are saved for) must be the one this server signed
 * (`sig` + `iat` inside the same base64 JSON the client already decodes).
 */
export function verifyDriveOAuthState(decoded: unknown): boolean {
  if (!decoded || typeof decoded !== "object") return false;
  const s = decoded as { sig?: unknown; iat?: unknown };
  const iat = Number(s.iat);
  if (typeof s.sig !== "string" || !Number.isFinite(iat)) return false;
  const age = Date.now() - iat;
  if (age < -60_000 || age > DRIVE_OAUTH_STATE_MAX_AGE_MS) return false;
  try {
    const want = Buffer.from(driveOAuthStateSig(decoded as Record<string, unknown>));
    const got = Buffer.from(s.sig);
    return want.length === got.length && timingSafeEqual(want, got);
  } catch {
    return false;
  }
}

/** Server-only — `googleapis` browser bundle me nahi aata. */
export function buildGoogleDriveAuthUrl(state: DriveOAuthState): string {
  const oauth2Client = createGoogleOAuth2Client(google);

  // drive.file sirf app-created files — sharedWithMe + shared folder read/write ke liye drive scope chahiye.
  const scopes = [
    "https://www.googleapis.com/auth/drive",
    "openid",
    "email",
    "profile",
  ];

  const unsigned = {
    returnPath: state.returnPath,
    uid: state.uid,
    email: state.email,
    formData: state.formData,
    iat: Date.now(),
  };
  const signed = { ...unsigned, sig: driveOAuthStateSig(unsigned) };
  const encodedState = Buffer.from(JSON.stringify(signed)).toString("base64");

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state: encodedState,
  });
}

/** Drive grant doc on the Pocket Ledger Server: `user_tokens/{uid}/google/drive` (`pl_billing_docs`). */
async function driveTokenRef(uid: string) {
  const id = String(uid || "").trim();
  if (!id) throw new Error("uid required");
  // Loaded lazily: this module is also imported by routes that never touch Drive.
  const { serverDb } = await import("@/lib/server/appDb");
  return serverDb().collection("user_tokens").doc(id).collection("google").doc("drive");
}

/** OAuth token shard hatao (Drive disconnect). */
export async function deleteGoogleDriveTokensForUser(uid: string): Promise<void> {
  const ref = await driveTokenRef(uid);
  await ref.delete();
}

export type GoogleDriveTokenPatch = {
  accessToken: string;
  refreshToken?: string | null;
  expiryDate?: number | null;
  scope?: string | null;
  tokenType?: string | null;
  connectedEmail?: string | null;
};

/** OAuth callback — token sirf server par (Pocket Ledger Server `pl_billing_docs`). */
export async function saveGoogleDriveTokensForUser(
  uid: string,
  patch: GoogleDriveTokenPatch
): Promise<void> {
  const ref = await driveTokenRef(uid);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? (existingSnap.data() as Record<string, unknown>) : {};
  const refreshToken =
    patch.refreshToken ?? (existing.refreshToken ? String(existing.refreshToken) : null);

  await ref.set(
    {
      accessToken: patch.accessToken,
      refreshToken,
      expiryDate: patch.expiryDate ?? null,
      scope: patch.scope ?? null,
      tokenType: patch.tokenType ?? null,
      connectedEmail: patch.connectedEmail ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** UI — Drive OAuth token shard present? */
export async function getGoogleDriveConnectionStatus(
  uid: string
): Promise<{ connected: boolean; email: string | null }> {
  const id = String(uid || "").trim();
  if (!id) return { connected: false, email: null };
  try {
    const ref = await driveTokenRef(id);
    const snap = await ref.get();
    if (!snap.exists) return { connected: false, email: null };
    const d = snap.data() as Record<string, unknown>;
    const accessToken = String(d.accessToken || "").trim();
    if (!accessToken) return { connected: false, email: null };
    const email = String(d.connectedEmail || "").trim() || null;
    return { connected: true, email };
  } catch {
    // Server not linked: the UI shows "not connected" instead of an error card.
    return { connected: false, email: null };
  }
}
