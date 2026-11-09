"use client";

/**
 * Firebase ID token refresh guard (securetoken.googleapis.com flood fix).
 * - Single-flight: parallel callers share one getIdToken() call.
 * - Forced refresh at most once per 5 min per user; otherwise cached getIdToken() (SDK still auto-renews near expiry).
 * - Permission-denied retries may force at most once per 60 s.
 * Never throws; returns null on failure / signed-out.
 */
import { auth } from "@/lib/plClientSession";
import { plRegistryPullDebug } from "@/lib/registryPullDebug";

const FORCE_MIN_INTERVAL_MS = 5 * 60_000;
const DENIED_FORCE_MIN_INTERVAL_MS = 60_000;

let inflight: Promise<string | null> | null = null;
let lastForcedAtMs = 0;
let lastDeniedForcedAtMs = 0;
let lastForcedUid = "";

export async function ensureFreshIdToken(opts?: {
  force?: boolean;
  /** Firestore permission-denied retry: separate (shorter) throttle. */
  permissionDenied?: boolean;
  source?: string;
}): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  if (inflight) return inflight;

  const now = Date.now();
  const uidChanged = user.uid !== lastForcedUid;
  let force = false;
  if (opts?.force) {
    if (uidChanged) force = true;
    else if (opts.permissionDenied) force = now - lastDeniedForcedAtMs >= DENIED_FORCE_MIN_INTERVAL_MS;
    else force = now - lastForcedAtMs >= FORCE_MIN_INTERVAL_MS;
    if (force) {
      lastForcedUid = user.uid;
      lastForcedAtMs = now;
      if (opts.permissionDenied) lastDeniedForcedAtMs = now;
    }
    plRegistryPullDebug("idToken", force ? "force refresh" : "force throttled -> cached token", {
      source: opts.source,
      permissionDenied: !!opts.permissionDenied,
    });
  }

  const p = user
    .getIdToken(force)
    .catch(() => null)
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}
