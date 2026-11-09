"use client";

/**
 * Server-only app session: the user signed in with their Pocket Ledger Server (`pl_users`)
 * email + password and has NO Firebase session.
 *
 * - `useAuth` turns it into a Firebase-shaped user (`providerId: "pocketbase"`, `getIdToken`
 *   throws) so the rest of the app keeps working.
 * - `useCompany` lists companies from `pl_companies` instead of Firestore.
 * - The read seam serves the company root from the server instead of Firestore.
 *
 * Kept: only the server token (pbClient) + a small profile cache (no secrets).
 * Firebase users are unchanged; a Firebase session always wins over this one.
 */

import type { User } from "@/lib/pbCompat/auth";
import {
  getValidPocketBaseAuth,
  pbListAll,
  pbRequest,
  pocketBaseSignOut,
  PL_PB_AUTH_CHANGED_EVENT,
} from "@/lib/pocketbaseData/pbClient";
import { registerPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { ONLINE_DATA_SERVER_POCKETBASE_ID } from "@/lib/onlineDataServer";
import { auth } from "@/lib/plClientSession";

const SESSION_KIND_KEY = "pl_app_session_kind_v1";
const PROFILE_KEY = "pl_pb_app_profile_v1";
export const PB_APP_SESSION_CHANGED_EVENT = "pl-pb-app-session-changed";
export const PB_SESSION_PROVIDER_ID = "pocketbase";
export const PB_SESSION_NO_FIREBASE_TOKEN = "PB_SESSION_NO_FIREBASE_TOKEN";

export type PocketBaseAppProfile = {
  id: string;
  email: string;
  name: string;
  appUid: string;
  appRole: string;
};

function ls(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function dispatchChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(PB_APP_SESSION_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

function hasFirebaseUserNow(): boolean {
  try {
    return !!auth?.currentUser;
  } catch {
    return false;
  }
}

export function readPocketBaseAppProfile(): PocketBaseAppProfile | null {
  const s = ls();
  if (!s) return null;
  try {
    const o = JSON.parse(s.getItem(PROFILE_KEY) || "null") as Partial<PocketBaseAppProfile> | null;
    if (!o || !o.id || !o.email) return null;
    return {
      id: String(o.id),
      email: String(o.email).toLowerCase(),
      name: String(o.name || ""),
      appUid: String(o.appUid || ""),
      appRole: String(o.appRole || ""),
    };
  } catch {
    return null;
  }
}

function writeProfile(p: PocketBaseAppProfile | null): void {
  const s = ls();
  if (!s) return;
  try {
    if (p) s.setItem(PROFILE_KEY, JSON.stringify(p));
    else s.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

/** Marker set only when the user signed in with the server login alone. */
export function isPocketBaseAppSessionMarked(): boolean {
  return ls()?.getItem(SESSION_KIND_KEY) === "pocketbase";
}

/** Server-only session is usable right now (marker + valid token + same account, no Firebase user). */
export function isPocketBaseAppSessionActive(): boolean {
  if (!isPocketBaseAppSessionMarked()) return false;
  const a = getValidPocketBaseAuth();
  if (!a) return false;
  const p = readPocketBaseAppProfile();
  if (!p || p.id !== a.userId) return false;
  return !hasFirebaseUserNow();
}

export function isPocketBaseSessionUser(user: unknown): boolean {
  return !!user && typeof user === "object" && (user as { providerId?: unknown }).providerId === PB_SESSION_PROVIDER_ID;
}

/** Uid used by the app for this account: the Firebase uid when the account was migrated. */
export function pocketBaseSessionUid(p: PocketBaseAppProfile): string {
  return p.appUid || `pb_${p.id}`;
}

export function buildPocketBaseSessionUser(p: PocketBaseAppProfile): User {
  const displayName = p.name || p.email.split("@")[0] || "User";
  return {
    uid: pocketBaseSessionUid(p),
    email: p.email,
    displayName,
    emailVerified: true,
    isAnonymous: false,
    providerId: PB_SESSION_PROVIDER_ID,
    providerData: [],
    getIdToken: async () => {
      throw new Error(PB_SESSION_NO_FIREBASE_TOKEN);
    },
  } as unknown as User;
}

/** Reads the signed-in `pl_users` record (own record only, by the collection rules). */
export async function fetchPocketBaseAppProfile(): Promise<PocketBaseAppProfile> {
  const a = getValidPocketBaseAuth();
  if (!a) throw new Error("Pocket Ledger Server: not signed in");
  const rec = (await pbRequest(`/api/collections/pl_users/records/${encodeURIComponent(a.userId)}`)) as Record<string, unknown>;
  if (rec?.disabled === true) throw new Error("This account is disabled. Contact your administrator.");
  return {
    id: String(rec?.id || a.userId),
    email: String(rec?.email || a.email || "").toLowerCase(),
    name: String(rec?.name || ""),
    appUid: String(rec?.app_uid || ""),
    appRole: String(rec?.app_role || ""),
  };
}

/** After a server-only sign-in: remember the session and tell `useAuth`. */
export async function startPocketBaseAppSession(): Promise<PocketBaseAppProfile> {
  const p = await fetchPocketBaseAppProfile();
  writeProfile(p);
  ls()?.setItem(SESSION_KIND_KEY, "pocketbase");
  dispatchChanged();
  return p;
}

/** Forget the server-only session marker (token handled by `pocketBaseSignOut`). */
export function clearPocketBaseAppSession(opts?: { signOutServer?: boolean }): void {
  const wasMarked = isPocketBaseAppSessionMarked();
  try {
    ls()?.removeItem(SESSION_KIND_KEY);
  } catch {
    /* ignore */
  }
  writeProfile(null);
  if (opts?.signOutServer) pocketBaseSignOut();
  if (wasMarked) dispatchChanged();
}

/** `useAuth` listens to both: server sign-in/out and session marker changes. */
export const PB_APP_SESSION_EVENTS = [PB_APP_SESSION_CHANGED_EVENT, PL_PB_AUTH_CHANGED_EVENT] as const;

export type PbRegistryRow = { id: string; data: Record<string, unknown>; isOwned: boolean };

/**
 * Company list of the signed-in server user (`pl_companies`: owner or member, by the rules).
 * Same shape as the Firestore registry pull. `cloudAllowedIds` is empty on purpose: never purge
 * local rows from a server listing.
 */
export async function pullPocketBaseCompanyRegistry(): Promise<{
  rows: PbRegistryRow[];
  ownedIds: Set<string>;
  sharedOnlyIds: Set<string>;
  cloudAllowedIds: Set<string>;
  /** Every `app_id` the server returned (also soft-deleted ones). Used to prune hard-deleted companies. */
  presentIds: Set<string>;
}> {
  const a = getValidPocketBaseAuth();
  if (!a) throw new Error("Pocket Ledger Server: not signed in");
  const recs = await pbListAll<Record<string, unknown>>("pl_companies", "app_id != ''", {
    fields: "id,app_id,name,owner,owner_email,data,deleted",
  });
  const { decodeDocFromPocketBase } = await import("@/lib/pocketbaseData/pbSync");
  const rows: PbRegistryRow[] = [];
  const ownedIds = new Set<string>();
  const sharedOnlyIds = new Set<string>();
  const presentIds = new Set<string>();
  for (const rec of recs) {
    const id = String(rec.app_id || "").trim();
    if (id) presentIds.add(id);
    if (!id || rec.deleted === true) continue;
    const raw = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : {};
    const data: Record<string, unknown> = { ...decodeDocFromPocketBase(raw) };
    delete data.password;
    if (!data.name && rec.name) data.name = String(rec.name);
    if (!data.ownerEmail && rec.owner_email) data.ownerEmail = String(rec.owner_email).toLowerCase();
    data.onlineServerId = ONLINE_DATA_SERVER_POCKETBASE_ID;
    const isOwned = String(rec.owner || "") === a.userId;
    registerPocketBaseCompanyId(id);
    rows.push({ id, data, isOwned });
    (isOwned ? ownedIds : sharedOnlyIds).add(id);
  }
  return { rows, ownedIds, sharedOnlyIds, cloudAllowedIds: new Set(), presentIds };
}
