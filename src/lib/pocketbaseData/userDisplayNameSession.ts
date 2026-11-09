/**
 * User display names without Firestore in a Pocket Ledger Server (server-only) session.
 * Server session: own profile name/email for own uid, else the caller's fallback (no Firebase user,
 * so Firestore would only fail with "client is offline"). Firebase session: unchanged getDoc users/{uid}.
 */
import { doc, getDoc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { isPocketBaseAppSessionActive, pocketBaseSessionUid, readPocketBaseAppProfile } from "@/lib/pocketbaseData/pbAppSession";

/** True when signed in with the Pocket Ledger Server login alone (no Firebase user). Never throws. */
export function isPbOnlySession(): boolean {
  try {
    return isPocketBaseAppSessionActive();
  } catch {
    return false;
  }
}

/** Server session only: own name/email for own uid, else `fallback`. `undefined` when not a server session. */
export function pbSessionUserName(userId: string, fallback: string): string | undefined {
  if (!isPbOnlySession()) return undefined;
  const p = readPocketBaseAppProfile();
  if (p && userId && (userId === pocketBaseSessionUid(p) || userId === p.id)) {
    return p.name || p.email || fallback;
  }
  return fallback;
}

/** Offline (`unavailable`) -> console.debug; other errors -> console.error as before. */
export function logUserNameLookupError(tag: string, userId: string, e: unknown): void {
  if ((e as { code?: unknown } | null)?.code === "unavailable") {
    console.debug(`[${tag}] userName lookup skipped (offline) for`, userId);
  } else {
    console.error(`[${tag}] Error fetching userName for`, userId, e);
  }
}

/** Server session: see `pbSessionUserName`. Otherwise `users/{uid}` displayName || email || fallback. */
export async function resolveUserDisplayName(userId: string, fallback: string, tag?: string): Promise<string> {
  const pb = pbSessionUserName(userId, fallback);
  if (pb !== undefined) return pb;
  try {
    const userDoc = await getDoc(doc(firestore, "users", userId));
    if (userDoc.exists()) {
      const d = userDoc.data();
      if (!d) return fallback;
      const displayName = typeof d.displayName === "string" ? d.displayName : "";
      const email = typeof d.email === "string" ? d.email : "";
      return displayName || email || fallback;
    }
  } catch (e) {
    // Callers used to swallow these silently; only log when a tag is given.
    if (tag) logUserNameLookupError(tag, userId, e);
  }
  return fallback;
}