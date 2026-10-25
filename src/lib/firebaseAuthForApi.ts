"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import {
  isPocketBaseAppSessionActive,
  pocketBaseSessionUid,
  readPocketBaseAppProfile,
} from "@/lib/pocketbaseData/pbAppSession";

/** Fast local unlock synthetic uid — Firebase token nahi deta, Drive API ke liye invalid. */
export const LOCAL_SYNTHETIC_AUTH_UID_PREFIX = "local:";

export const FIREBASE_SIGN_IN_REQUIRED_FOR_DRIVE_MSG =
  "Google account sign-in required for Drive sync";

export const LOCAL_UNLOCK_ONLY_DRIVE_MSG =
  "Local company unlock is not enough — sign in with your Google account, then Connect account for Drive.";

export class DriveAuthRequiredError extends Error {
  readonly code = "drive_auth_required" as const;

  constructor(message: string) {
    super(message);
    this.name = "DriveAuthRequiredError";
  }
}

export function isLocalSyntheticAuthUid(uid: string | null | undefined): boolean {
  return !!uid && uid.startsWith(LOCAL_SYNTHETIC_AUTH_UID_PREFIX);
}

/** IndexedDB session restore hone tak wait — startup par turant null mat mano. */
export async function waitForFirebaseAuthReady(): Promise<void> {
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
  }
}

/** Real Firebase session (local synthetic `local:*` nahi). */
export function hasRealFirebaseAuthSession(): boolean {
  const user = auth.currentUser;
  return !!user && !isLocalSyntheticAuthUid(user.uid);
}

/** Drive / billing hosted API — real Firebase user + fresh ID token. */
export async function getFirebaseAuthUserForApi(): Promise<User> {
  await waitForFirebaseAuthReady();
  const user = auth.currentUser;
  if (!user) {
    throw new DriveAuthRequiredError(FIREBASE_SIGN_IN_REQUIRED_FOR_DRIVE_MSG);
  }
  if (isLocalSyntheticAuthUid(user.uid)) {
    throw new DriveAuthRequiredError(LOCAL_UNLOCK_ONLY_DRIVE_MSG);
  }
  return user;
}

export async function getFirebaseIdTokenForApi(): Promise<{ user: User; token: string }> {
  const user = await getFirebaseAuthUserForApi();
  const token = await user.getIdToken();
  return { user, token };
}

/**
 * Drive API caller: the Firebase user (older accounts), or the Pocket Ledger Server login
 * (`pl_users`, no Firebase session). Drive itself is connected separately with its own Google
 * authorization, so it works with either login.
 */
export type DriveApiUser = {
  uid: string;
  email: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

/** Bearer prefix the hosted API accepts for a Pocket Ledger Server token. */
export const DRIVE_API_PB_TOKEN_PREFIX = "plpb.";

function pocketBaseDriveApiUser(): DriveApiUser | null {
  if (!isPocketBaseAppSessionActive()) return null;
  const a = getValidPocketBaseAuth();
  const p = readPocketBaseAppProfile();
  if (!a || !p) return null;
  return {
    uid: pocketBaseSessionUid(p),
    email: p.email || a.email || null,
    getIdToken: async () => {
      const now = getValidPocketBaseAuth();
      if (!now) throw new DriveAuthRequiredError(FIREBASE_SIGN_IN_REQUIRED_FOR_DRIVE_MSG);
      return `${DRIVE_API_PB_TOKEN_PREFIX}${now.token}`;
    },
  };
}

/** Signed in for Drive API calls (Firebase account or server login). */
export function hasDriveApiAuthSession(): boolean {
  return hasRealFirebaseAuthSession() || !!pocketBaseDriveApiUser();
}

export async function getDriveApiUser(): Promise<DriveApiUser> {
  await waitForFirebaseAuthReady();
  if (!auth.currentUser) {
    const pb = pocketBaseDriveApiUser();
    if (pb) return pb;
  }
  return getFirebaseAuthUserForApi();
}

export async function getDriveApiIdToken(): Promise<{ user: DriveApiUser; token: string }> {
  const user = await getDriveApiUser();
  const token = await user.getIdToken();
  return { user, token };
}

/** Purana / naya auth error text — stale registry error clear karne ke liye. */
export function isStoredDriveAuthError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes("sign in required") ||
    m.includes("google account sign-in required") ||
    m.includes("local company unlock is not enough")
  );
}

export function isDriveAuthRequiredError(e: unknown): boolean {
  if (e instanceof DriveAuthRequiredError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return isStoredDriveAuthError(msg);
}

/**
 * Plan / billing API token: the Firebase user's ID token when signed in with Firebase (older accounts,
 * Firestore companies), else the Pocket Ledger Server login (`plpb.` bearer -> server store),
 * else `fallback` (whatever the page already had).
 */
export async function getBillingApiIdToken(
  fallback?: { getIdToken: (forceRefresh?: boolean) => Promise<string> } | null
): Promise<string> {
  await waitForFirebaseAuthReady();
  const fb = auth.currentUser;
  if (fb && !isLocalSyntheticAuthUid(fb.uid)) return fb.getIdToken();
  const pb = pocketBaseDriveApiUser();
  if (pb) return pb.getIdToken();
  if (fallback) return fallback.getIdToken();
  throw new DriveAuthRequiredError(FIREBASE_SIGN_IN_REQUIRED_FOR_DRIVE_MSG);
}

/** `Authorization` header only for a server login (routes that work without auth for Firebase users). */
export async function getServerLoginBillingAuthHeader(): Promise<Record<string, string>> {
  await waitForFirebaseAuthReady();
  const fb = auth.currentUser;
  if (fb && !isLocalSyntheticAuthUid(fb.uid)) return {};
  const pb = pocketBaseDriveApiUser();
  if (!pb) return {};
  try {
    return { Authorization: `Bearer ${await pb.getIdToken()}` };
  } catch {
    return {};
  }
}

/** Like `onAuthStateChanged`, but a signed-out Firebase state falls back to the server login. */
export function onBillingApiUser(cb: (user: DriveApiUser | null) => void | Promise<void>): () => void {
  return onAuthStateChanged(auth, (u) => {
    if (u && !isLocalSyntheticAuthUid(u.uid)) {
      void cb({ uid: u.uid, email: u.email, getIdToken: (f?: boolean) => u.getIdToken(f) });
      return;
    }
    void cb(pocketBaseDriveApiUser());
  });
}
