/**
 * Auth handle used by the app. Firebase Authentication is no longer used: the only login is the
 * Pocket Ledger Server (PocketBase) session, driven by `pbAppSession` / `useAuth`.
 *
 * This module keeps the small Firebase-shaped surface older code still calls
 * (`auth.currentUser`, `authStateReady`, `onAuthStateChanged`, `signOut`). There is never a Firebase
 * session any more, so `currentUser` is always null and the PB-session branches take over.
 * No "firebase/auth" runtime import remains here.
 */

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  providerId: string;
  providerData: Array<{ providerId: string; uid?: string; email?: string | null }>;
  photoURL?: string | null;
  phoneNumber?: string | null;
  tenantId?: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

export interface Auth {
  readonly currentUser: User | null;
  authStateReady: () => Promise<void>;
  signOut: () => Promise<void>;
}

export type UserCredential = { user: User };

const authSingleton: Auth = {
  currentUser: null,
  authStateReady: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
};

export function getAuth(_app?: unknown): Auth {
  return authSingleton;
}

/** No Firebase session exists: reports `null` once (asynchronously) and never changes. */
export function onAuthStateChanged(
  _auth: Auth,
  next: (user: User | null) => void,
  _error?: (e: Error) => void
): () => void {
  let live = true;
  queueMicrotask(() => {
    if (live) next(null);
  });
  return () => {
    live = false;
  };
}

export function signOut(_auth?: Auth): Promise<void> {
  return Promise.resolve();
}