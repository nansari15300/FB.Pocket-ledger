"use client";

import { pocketBaseGoogleSignIn } from "@/lib/pocketbaseData/pbClient";
import { startPocketBaseAppSession } from "@/lib/pocketbaseData/pbAppSession";

export type GoogleSignInForAppOptions = {
  loginHint?: string;
  forceAccountPicker?: boolean;
};

/**
 * "Login with Google" for the app = Pocket Ledger Server (PocketBase) Google login.
 * (Kept under the old module name so existing imports keep working; no Firebase involved.)
 */
export async function signInWithGoogleForApp(_options?: GoogleSignInForAppOptions): Promise<null> {
  await pocketBaseGoogleSignIn();
  await startPocketBaseAppSession();
  return null;
}