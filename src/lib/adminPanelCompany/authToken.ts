"use client";

import { auth } from "@/lib/plClientSession";
import {
  isLocalSyntheticAuthUid,
  waitForFirebaseAuthReady,
} from "@/lib/firebaseAuthForApi";

/**
 * Wait for Firebase IndexedDB session restore before reading currentUser.
 * HMR / hard refresh pe auth.currentUser briefly null hota hai — turant fail mat karo.
 */
export async function getAdminPanelCompanyIdToken(): Promise<string> {
  await waitForFirebaseAuthReady();
  const user = auth.currentUser;
  if (!user || isLocalSyntheticAuthUid(user.uid)) {
    throw new Error("Sign in required");
  }
  return user.getIdToken();
}
