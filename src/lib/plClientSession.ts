'use client';

/**
 * Pocket Ledger client session helpers (formerly @/lib/firebase shim).
 * Document store handle comes from pbCompat/firestore. Auth is PB session (pbAppSession / useAuth);
 * this auth object stays Firebase-shaped but always null for currentUser.
 */

import { firestoreHandle } from "@/lib/pbCompat/firestore";
import type { User as PbUser } from "@/lib/pbCompat/auth";

export type AuthLike = {
  currentUser: { email?: string | null; uid?: string; getIdToken?: (forceRefresh?: boolean) => Promise<string> } | null;
  signOut?: () => Promise<void>;
  onAuthStateChanged?: (cb: (u: unknown) => void) => () => void;
};

/** Google OAuth Web client ID for Capacitor GoogleAuth.initialize (public client id). */
export const FIREBASE_WEB_OAUTH_CLIENT_ID = "469450068553-h848203thcqi3u8mvl8bvnm7gh8v5icl.apps.googleusercontent.com";

/** Store handle for doc()/collection() — Pocket Ledger Server. */
export const firestore = firestoreHandle;
export const app = Object.freeze({ name: "[PL]", options: {}, __plServerApp: true as const });

/** Compatible with pbCompat/auth User (fixes prior providerData: unknown[] mismatch). */
export type FirebaseUserLike = PbUser & {
  photoURL: string | null;
  phoneNumber: string | null;
  refreshToken: string;
  metadata: { creationTime?: string; lastSignInTime?: string };
  getIdTokenResult(forceRefresh?: boolean): Promise<unknown>;
  reload(): Promise<void>;
  delete(): Promise<void>;
  toJSON(): Record<string, unknown>;
};

export const auth = {
  currentUser: null as FirebaseUserLike | null,
  signOut: async (): Promise<void> => {
    await clearPocketBaseAppSessionOnLogout();
  },
  onAuthStateChanged: (_cb: (u: FirebaseUserLike | null) => void): (() => void) => () => undefined,
  authStateReady: async (): Promise<void> => undefined,
  currentUser_placeholder: true as const,
};

/** Legacy Firebase storage handle is null; files use pbStorage / pl_stored_files. */
export const storage = null;

export function isFirestoreBlockedForServerSession(): boolean {
  return true;
}

export let firestoreNetworkDisabledByApi = false;

export function markFirestoreNetworkDisabledByApi(_disabled: boolean): void {
  firestoreNetworkDisabledByApi = false;
}

export function queueFirestoreNetworkOp<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

export async function settleAfterFirestoreNetworkEnabled(): Promise<void> {}
export async function enqueueSyncFirestoreNetworkFromLocalConfig(): Promise<void> {}
export async function ensureEmbeddedFirestoreOnlineForCloudCompanyLoad(): Promise<void> {}
export async function syncEmbeddedFirestoreTransportFromNavigator(): Promise<void> {}

export async function clearPocketBaseAppSessionOnLogout(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const m = await import("@/lib/pocketbaseData/pbAppSession");
    m.clearPocketBaseAppSession({ signOutServer: true });
  } catch {
    /* ignore */
  }
}

export async function signOutWithFirestoreTeardown(_auth?: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const m = await import("@/lib/embeddedWarmBootstrapFlags");
    m.clearEmbeddedWarmBootstrapFlags();
  } catch {
    /* ignore */
  }
  try {
    const m = await import("@/lib/companyPickerFirestoreDetach");
    m.detachCompanyPickerFirestoreListenersIfAny();
  } catch {
    /* ignore */
  }
  await clearPocketBaseAppSessionOnLogout();
  await new Promise<void>((r) => setTimeout(r, 80));
}

if (typeof window !== "undefined") {
  let reloadScheduled = false;
  const reloadForSessionSwitch = () => {
    if (reloadScheduled) return;
    reloadScheduled = true;
    window.setTimeout(() => window.location.reload(), 1200);
  };
  window.addEventListener("pl-pb-app-session-changed", () => {
    try {
      const marker = window.localStorage.getItem("pl_app_session_kind_v1");
      if (marker !== "pocketbase") reloadForSessionSwitch();
    } catch {
      /* ignore */
    }
  });
}

export { isFirestoreWatchTeardownAssertionMessage } from "@/lib/firestoreWatchAssertionGuard";
