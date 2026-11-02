"use client";

import { clientRandomUUID } from "@/lib/clientRandomUUID";

/**
 * Offline local companies: company users sirf browser SQLite company row me (localCompanyUsers).
 * Local Node API (127.0.0.1:3001) optional — baad me sync add ho sakta hai.
 */

import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import type { GateRecord } from "@/lib/gates/gateTypes";
import { setBackupEncryptionSessionFromLogin } from "@/lib/serverBackupEncryption";
import { normalizeLocalCompanyAppRole } from "@/lib/localCompanyAppRoles";

/** Serialize `localCompanyUsers` root writes per company — profile backfill vs role save race. */
const localCompanyUsersWriteChain = new Map<string, Promise<unknown>>();

export async function withLocalCompanyUsersWriteLock<T>(
  companyId: string,
  fn: () => Promise<T>
): Promise<T> {
  const cid = String(companyId || "").trim();
  if (!cid) return fn();
  const prev = localCompanyUsersWriteChain.get(cid) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tracked = prev.catch(() => undefined).then(() => gate);
  localCompanyUsersWriteChain.set(cid, tracked);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (localCompanyUsersWriteChain.get(cid) === tracked) {
      localCompanyUsersWriteChain.delete(cid);
    }
  }
}

/** Company user row — password local blob me (device pe hi), server jaisa trust model. */
export type LocalCompanyUserRecord = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  password: string;
  /** Firebase Auth uid — is app login par hi username/password valid (admin bypass alag). */
  uid?: string | null;
  /** Invite/share Gmail — login username alag ho to bhi profile + online match ho sake. */
  shareEmail?: string | null;
};

/** UI list ke liye password field hata do. */
export function localCompanyUsersToPublicList(
  rows: LocalCompanyUserRecord[]
): Array<{ id: string; username: string; displayName?: string; role?: string }> {
  return rows.map(({ id, username, displayName, role }) => ({
    id,
    username,
    displayName,
    role,
  }));
}

/** Firestore/local JSON se users array normalize karo (Edit + create flow). */
export function parseLocalCompanyUserRows(raw: unknown): LocalCompanyUserRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: LocalCompanyUserRecord[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const username = typeof o.username === "string" ? o.username : "";
    const displayName = typeof o.displayName === "string" ? o.displayName : "";
    const role = typeof o.role === "string" ? o.role : "manager";
    const password = typeof o.password === "string" ? o.password : "";
    const uid = typeof o.uid === "string" && o.uid.trim() ? o.uid.trim() : null;
    const rawShareEmail =
      typeof o.shareEmail === "string" && o.shareEmail.trim().includes("@")
        ? o.shareEmail
        : typeof o.email === "string" && o.email.trim().includes("@")
          ? o.email
          : "";
    const shareEmail = rawShareEmail ? rawShareEmail.trim().toLowerCase() : null;
    if (!id || !username) continue;
    out.push({
      id,
      username,
      displayName,
      role: normalizeLocalCompanyAppRole(role),
      password,
      uid,
      shareEmail,
    });
  }
  return out;
}

/** Drive share Gmail list → SQLite `localCompanyUsers` (app role; Drive hamesha writer). */
export function mergeDriveShareUsersIntoLocalCompanyUsers(
  rows: LocalCompanyUserRecord[],
  shareUsers: Array<{ email: string; appRole: string }>
): LocalCompanyUserRecord[] {
  if (!Array.isArray(shareUsers) || shareUsers.length === 0) return [...rows];
  let next = [...rows];
  for (const u of shareUsers) {
    const email = String(u?.email || "")
      .trim()
      .toLowerCase();
    if (!email.includes("@")) continue;
    const role = normalizeLocalCompanyAppRole(u.appRole);
    const idx = next.findIndex((x) => x.username.toLowerCase() === email);
    if (idx >= 0) {
      // Purana password mat hatao — Drive `opening/users.json` se aata hai.
      next[idx] = { ...next[idx], role, displayName: next[idx].displayName || email };
    } else {
      next = upsertUserInList(next, {
        username: email,
        displayName: email,
        role,
        password: "",
      });
    }
  }
  return next;
}

/** Drive `opening/users.json` row — shared devices par login password merge. */
export type OpeningUserSnapshot = {
  username?: string;
  displayName?: string;
  role?: string;
  password?: string;
};

/** Remote users snapshot → local rows; password sirf tab update jab remote me non-empty ho. */
export function mergeOpeningUsersSnapshotIntoLocalCompanyUsers(
  rows: LocalCompanyUserRecord[],
  remoteUsers: OpeningUserSnapshot[]
): LocalCompanyUserRecord[] {
  if (!Array.isArray(remoteUsers) || remoteUsers.length === 0) return [...rows];
  let next = [...rows];
  for (const ru of remoteUsers) {
    const username = String(ru.username ?? "").trim();
    if (!username) continue;
    const password = String(ru.password ?? "").trim();
    const idx = next.findIndex((x) => x.username.toLowerCase() === username.toLowerCase());
    if (idx >= 0) {
      const row = { ...next[idx] };
      if (ru.displayName != null && String(ru.displayName).trim()) {
        row.displayName = String(ru.displayName).trim();
      }
      if (ru.role != null && String(ru.role).trim()) {
        row.role = normalizeLocalCompanyAppRole(ru.role);
      }
      if (password) row.password = password;
      next[idx] = row;
    } else {
      next = upsertUserInList(next, {
        username,
        displayName: String(ru.displayName ?? username).trim() || username,
        role: ru.role != null ? normalizeLocalCompanyAppRole(ru.role) : "manager",
        password,
      });
    }
  }
  return next;
}

/** Share list se ek Gmail user hatao — localCompanyUsers se bhi. */
export function removeDriveShareUserFromLocalCompanyUsers(
  rows: LocalCompanyUserRecord[],
  email: string
): LocalCompanyUserRecord[] {
  const em = String(email || "")
    .trim()
    .toLowerCase();
  if (!em) return [...rows];
  return rows.filter((x) => x.username.toLowerCase() !== em);
}

/** Firestore `companies.sharedWith` entry — SQLite `localCompanyUsers` mirror ke liye. */
export type FirestoreSharedUser = {
  email?: string;
  name?: string;
  role?: string;
  password?: string | null;
  uid?: string | null;
};

const VALID_SHARED_ROLES = ["viewer", "data-entry", "accountant", "editor", "manager", "admin", "owner"] as const;

/**
 * Cloud `sharedWith` ko device SQLite `localCompanyUsers` me merge — offline login + "Existing Company Users" list.
 * Pehle se maujood rows (jaise Admin) preserve; email = online login id.
 */
export function mergeSharedWithIntoLocalCompanyUsers(
  rows: LocalCompanyUserRecord[],
  sharedWith: FirestoreSharedUser[]
): LocalCompanyUserRecord[] {
  if (!Array.isArray(sharedWith) || sharedWith.length === 0) {
    return [...rows];
  }
  let next = [...rows];
  for (const u of sharedWith) {
    const email = String(u?.email || "").trim();
    if (!email) continue;
    const name = String(u?.name || "").trim() || email;
    let role =
      String(u?.role || "viewer")
        .trim()
        .toLowerCase()
        .replace(/_/g, "-")
        .replace(/\s+/g, "-") || "viewer";
    if (!VALID_SHARED_ROLES.includes(role as (typeof VALID_SHARED_ROLES)[number])) {
      role = "viewer";
    }
    const pwFromShared =
      u?.password != null && String(u.password).trim() !== "" ? String(u.password).trim() : "";
    const idx = next.findIndex((x) => x.username.toLowerCase() === email.toLowerCase());
    if (idx >= 0) {
      const row = { ...next[idx] };
      row.displayName = name;
      row.role = role;
      if (pwFromShared) row.password = pwFromShared;
      if (u?.uid) row.uid = String(u.uid).trim();
      next[idx] = row;
    } else {
      next = upsertUserInList(next, {
        username: email,
        displayName: name,
        role,
        password: pwFromShared,
        uid: u?.uid ? String(u.uid).trim() : null,
      });
    }
  }
  return next;
}

/** App login (Firebase uid / email) se is company ki user row dhoondo. */
export function findLocalCompanyUserRowForAppUser(
  users: LocalCompanyUserRecord[],
  firebaseUid?: string | null,
  userEmail?: string | null
): LocalCompanyUserRecord | null {
  const uid = String(firebaseUid || "").trim();
  if (uid) {
    const byUid = users.find((x) => String(x.uid || "").trim() === uid);
    if (byUid) return byUid;
  }
  const email = String(userEmail || "").toLowerCase().trim();
  if (email) {
    const byEmail = users.find((x) => x.username.toLowerCase() === email);
    if (byEmail) return byEmail;
    const localPart = email.includes("@") ? email.split("@")[0]!.trim().toLowerCase() : "";
    if (localPart) {
      const byLocal = users.find((x) => x.username.toLowerCase() === localPart);
      if (byLocal) return byLocal;
    }
  }
  return null;
}

/** Same username par naya password/display update; naya user ho to push. */
export function upsertUserInList(
  list: LocalCompanyUserRecord[],
  entry: {
    username: string;
    displayName: string;
    role: string;
    password: string;
    uid?: string | null;
    shareEmail?: string | null;
  }
): LocalCompanyUserRecord[] {
  const u = entry.username.trim().toLowerCase();
  const idx = list.findIndex((x) => x.username.toLowerCase() === u);
  const id = idx >= 0 ? list[idx].id : `lcu_${clientRandomUUID()}`;
  const prevUid = idx >= 0 ? list[idx].uid : null;
  const prevShareEmail = idx >= 0 ? list[idx].shareEmail : null;
  const shareEmail =
    entry.shareEmail !== undefined
      ? entry.shareEmail
      : prevShareEmail ?? null;
  const row: LocalCompanyUserRecord = {
    id,
    username: entry.username.trim(),
    displayName: entry.displayName.trim(),
    role: entry.role.trim().toLowerCase() || "manager",
    password: entry.password,
    uid: entry.uid !== undefined ? entry.uid : prevUid ?? null,
    shareEmail,
  };
  const next = [...list];
  if (idx >= 0) next[idx] = row;
  else next.push(row);
  return next;
}

/** SQLite company doc se users array read (validated). */
export async function getLocalCompanyUsersRecords(companyId: string): Promise<LocalCompanyUserRecord[]> {
  const doc = await getLocalCompanyById(companyId, { includeDeleted: true });
  if (!doc) return [];
  return parseLocalCompanyUserRows((doc as LocalCompanyDoc & { localCompanyUsers?: unknown }).localCompanyUsers);
}

/**
 * Ek naya user add karo — duplicate username par error throw.
 */
/** Saved user row hatao (Edit Company → Existing users list). */
export async function removeLocalCompanyUserByIdClient(companyId: string, userId: string): Promise<void> {
  const existing = await getLocalCompanyById(companyId, { includeDeleted: true });
  if (!existing) throw new Error("Local company not found");
  const prev = parseLocalCompanyUserRows((existing as LocalCompanyDoc & { localCompanyUsers?: unknown }).localCompanyUsers);
  const next = prev.filter((x) => x.id !== userId);
  await upsertLocalCompany({
    ...existing,
    id: companyId,
    localCompanyUsers: next,
    updatedAt: Date.now(),
  } as LocalCompanyDoc);
  void import("@/lib/plServerCompanyMetaSync").then(({ notifyPlServerHostCompanyMetaSaved }) =>
    notifyPlServerHostCompanyMetaSaved(companyId)
  );
}

/** Display name / role / password update — password khali chhodo to purana hi rahe. */
export async function updateLocalCompanyUserClient(
  companyId: string,
  userId: string,
  patch: { displayName?: string; role?: string; password?: string }
): Promise<void> {
  const existing = await getLocalCompanyById(companyId, { includeDeleted: true });
  if (!existing) throw new Error("Local company not found");
  const prev = parseLocalCompanyUserRows((existing as LocalCompanyDoc & { localCompanyUsers?: unknown }).localCompanyUsers);
  const idx = prev.findIndex((x) => x.id === userId);
  if (idx < 0) throw new Error("User not found");
  const row = { ...prev[idx] };
  if (patch.displayName !== undefined) row.displayName = patch.displayName.trim();
  if (patch.role !== undefined) row.role = patch.role.trim().toLowerCase() || "manager";
  if (patch.password !== undefined && patch.password.length > 0) row.password = patch.password;
  const next = [...prev];
  next[idx] = row;
  await upsertLocalCompany({
    ...existing,
    id: companyId,
    localCompanyUsers: next,
    updatedAt: Date.now(),
  } as LocalCompanyDoc);
  void import("@/lib/plServerCompanyMetaSync").then(({ notifyPlServerHostCompanyMetaSaved }) =>
    notifyPlServerHostCompanyMetaSaved(companyId)
  );
}

export async function appendLocalCompanyUserClient(
  companyId: string,
  entry: { username: string; displayName: string; role: string; password: string }
): Promise<void> {
  const existing = await getLocalCompanyById(companyId, { includeDeleted: true });
  if (!existing) throw new Error("Local company not found");
  const prev = parseLocalCompanyUserRows((existing as LocalCompanyDoc & { localCompanyUsers?: unknown }).localCompanyUsers);
  const u = entry.username.trim().toLowerCase();
  if (prev.some((x) => x.username.toLowerCase() === u)) {
    throw new Error("Username already exists for this company.");
  }
  const next = upsertUserInList(prev, entry);
  await upsertLocalCompany({
    ...existing,
    id: companyId,
    localCompanyUsers: next,
    updatedAt: Date.now(),
  } as LocalCompanyDoc);
  void import("@/lib/plServerCompanyMetaSync").then(({ notifyPlServerHostCompanyMetaSaved }) =>
    notifyPlServerHostCompanyMetaSaved(companyId)
  );
}

/**
 * Username/password se session — bina local API ke (static / offline admin flow).
 * Pehle `localCompanyUsers` rows; match na ho to company doc ka adminUsername + root company password (purana / bina row data).
 */
export async function localAuthLoginClientOnly(
  companyId: string,
  username: string,
  password: string,
  appUser?: { uid?: string | null; email?: string | null },
  options?: { remoteGate?: boolean }
): Promise<{ token: string; user: { id: string; username: string; displayName?: string; role?: string } }> {
  const remoteGate = options?.remoteGate === true;
  const u = username.trim().toLowerCase();
  const p = password.trim();

  const doc = await getLocalCompanyById(companyId, { includeDeleted: true });
  if (!doc) throw new Error("Invalid username or password");

  const { isCurrentUserOwnerOfCompanyRow } = await import("@/lib/companyOnlineIntegrity");
  const isOwner = isCurrentUserOwnerOfCompanyRow(doc, {
    uid: String(appUser?.uid || "").trim(),
    email: appUser?.email ?? null,
  });

  const users = await getLocalCompanyUsersRecords(companyId);
  const hasProtectPassword = Boolean(String((doc as { password?: string | null }).password ?? "").trim());
  const hasLocalUsers = users.length > 0;

  if (remoteGate && !hasProtectPassword && !hasLocalUsers) {
    const token = `local_client_${companyId}_remote_open_${Date.now()}`;
    return {
      token,
      user: {
        id: "remote_viewer",
        username: "guest",
        displayName: "Guest",
        role: "viewer",
      },
    };
  }

  if (remoteGate && !u && !p && !hasProtectPassword && !hasLocalUsers) {
    const token = `local_client_${companyId}_remote_open_${Date.now()}`;
    return {
      token,
      user: {
        id: "remote_viewer",
        username: "guest",
        displayName: "Guest",
        role: "viewer",
      },
    };
  }

  let match = users.find((x) => x.username.toLowerCase() === u && x.password === p);
  if (!match) {
    match = users.find(
      (x) => String(x.displayName || "").trim().toLowerCase() === u && x.password === p
    );
  }

  if (match) {
    const rowUid = String(match.uid || "").trim();
    const appUid = String(appUser?.uid || "").trim();
    if (!remoteGate && !isOwner && rowUid && appUid && rowUid !== appUid) {
      throw new Error("Invalid username or password");
    }
    const token = `local_client_${companyId}_${match.id}_${Date.now()}`;
    if (typeof window !== "undefined") {
      void setBackupEncryptionSessionFromLogin(companyId, username, password);
    }
    return {
      token,
      user: {
        id: match.id,
        username: match.username,
        displayName: match.displayName,
        role: match.role,
      },
    };
  }

  const companyPw = String((doc as { password?: string | null }).password ?? "");
  if (!companyPw || p !== companyPw) throw new Error("Invalid username or password");

  let adminLogin = String((doc as { adminUsername?: string | null }).adminUsername ?? "").trim();
  if (!adminLogin) {
    const oe = String((doc as { ownerEmail?: string | null }).ownerEmail ?? "");
    adminLogin = oe.includes("@") ? oe.split("@")[0].trim() : "";
  }

  if (adminLogin && u === adminLogin.toLowerCase() && (isOwner || remoteGate)) {
    const token = `local_client_${companyId}_admin_fallback_${Date.now()}`;
    if (typeof window !== "undefined") {
      void setBackupEncryptionSessionFromLogin(companyId, username, password);
    }
    return {
      token,
      user: {
        id: "local_admin_fallback",
        username: adminLogin,
        displayName: "Admin",
        role: "manager",
      },
    };
  }

  throw new Error("Invalid username or password");
}

/** Device SQLite login, ya remote server client par server PC ke SQLite se verify. */
export async function localAuthLoginForCompanyContext(
  companyId: string,
  username: string,
  password: string,
  options?: {
    plServerGate?: GateRecord | null;
    forcePlServerRemote?: boolean;
    skipPostLoginSync?: boolean;
    appUser?: { uid?: string | null; email?: string | null };
  }
): Promise<{ token: string; user: { id: string; username: string; displayName?: string; role?: string } }> {
  const {
    plServerRemoteCompanyLogin,
    shouldUsePlServerRemoteCompanyLogin,
  } = await import("@/lib/plServerRemoteCompanyLogin");
  const remoteOpts = options?.plServerGate ? { gate: options.plServerGate } : undefined;
  const useRemote =
    options?.forcePlServerRemote === true ||
    (await shouldUsePlServerRemoteCompanyLogin(companyId, remoteOpts));
  if (useRemote) {
    const result = await plServerRemoteCompanyLogin(companyId, username, password, remoteOpts);
    if (!options?.skipPostLoginSync) {
      const { syncPlServerSharedCompanyById } = await import("@/lib/plServerClientCompanyDelta");
      await syncPlServerSharedCompanyById(companyId, { pullFullLedger: true });
    }
    if (typeof window !== "undefined") {
      const { setBackupEncryptionSessionFromLogin } = await import("@/lib/serverBackupEncryption");
      void setBackupEncryptionSessionFromLogin(companyId, username, password);
    }
    return result;
  }
  return localAuthLoginClientOnly(companyId, username, password, options?.appUser);
}
