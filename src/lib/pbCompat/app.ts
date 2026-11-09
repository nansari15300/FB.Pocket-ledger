'use client';

/**
 * The app "app" handle — no Firebase SDK.
 *
 * `initializeFirebase()` (src/firebase/index.ts) used to create a Firebase app so the client SDK could
 * read Firestore. The store is the Pocket Ledger Server now, so this only needs to hand out a stable,
 * serialisable handle: authentication goes through PocketBase OAuth, data through `pbCompat/firestore`.
 */

export type FirebaseApp = {
  readonly name: string;
  readonly options: Record<string, unknown>;
  readonly __plServerApp: true;
};

/** The single app handle (created on first use, kept for the tab lifetime). */
const sharedApp: FirebaseApp = Object.freeze({
  name: "[PL]",
  options: {},
  __plServerApp: true as const,
});

export function initializeApp(_options?: unknown, name?: string): FirebaseApp {
  void _options;
  if (name && name !== sharedApp.name) return { ...sharedApp, name };
  return sharedApp;
}

export function getApps(): FirebaseApp[] {
  return [sharedApp];
}

export function getApp(name?: string): FirebaseApp {
  if (name && name !== sharedApp.name) return { ...sharedApp, name };
  return sharedApp;
}

export function deleteApp(_app?: FirebaseApp): Promise<void> {
  return Promise.resolve();
}

/**
 * SDK logger hook. There is no Firebase SDK to listen to any more (it would have reported quota
 * failures); the call stays so `onlineTriggerLog` keeps compiling, and never fires.
 */
export function onLog(
  _fn: (entry: { level?: string; message?: string; args?: unknown[] }) => void,
  _options?: { level?: string }
): void {
  /* no SDK logger */
}

export function setLogLevel(_level: string): void {
  /* no SDK to configure */
}

export type FirebaseOptions = Record<string, unknown>;
