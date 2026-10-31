"use client";

/**
 * Cross-port login handoff used to carry a Firebase custom token (3000 -> 3001). Firebase sign-in is
 * gone, so there is no token to carry: these stay as inert stubs so the connect-URL code is unchanged.
 * (A Pocket Ledger Server session is stored per origin; sign in once on the new origin.)
 */

/** Source origin: no Firebase session, nothing to hand off. */
export async function fetchPlFirebaseHandoffCustomToken(): Promise<string | null> {
  return null;
}

export function appendPlFirebaseHandoffToConnectUrl(connectUrl: string, _customToken: string): string {
  return connectUrl;
}

/** Destination: nothing to read. */
export function readAndStripPlFirebaseHandoffFromLanding(): string | null {
  return null;
}

export async function applyPlFirebaseHandoffCustomToken(_customToken: string): Promise<boolean> {
  return false;
}