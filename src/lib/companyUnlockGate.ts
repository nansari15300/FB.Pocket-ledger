import type { Company } from "@/hooks/useCompany";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { parseLocalCompanyUserRows, findLocalCompanyUserRowForAppUser } from "@/lib/localCompanyUsers";
import { isServerGateCompany } from "@/lib/companyStorageKind";
import { isCurrentUserOwnerOfCompanyRow } from "@/lib/companyOnlineIntegrity";
import {
  hasValidStoredOfflineUnlockSession,
  readStoredOfflineUnlockSession,
} from "@/lib/offlineCompanyUnlockRemember";
import { readCloudCompanyPasswordUnlockSession } from "@/lib/cloudCompanyPasswordUnlockRemember";
import { getLocalAuthToken, setLocalAuthToken } from "@/lib/localApiClient";

/** Company row jisme selector `isOwned` set karta hai */
export type CompanyUnlockRow = Company & { isOwned?: boolean };

type CompanyStorageRow = {
  storageOption?: string | null;
  syncedFromCloud?: boolean;
};

/** Firestore mirror / explicit firebase|drive — device-local SQLite row nahi. */
export function isCloudLinkedCompanyStorage(c: CompanyStorageRow): boolean {
  if (c.syncedFromCloud === true) return true;
  const so = String(c.storageOption ?? "").toLowerCase().trim();
  return so === "firebase" || so === "drive";
}

/**
 * Device-local company (SQLite-first / Drive restore).
 * Missing `storageOption` default local — **lekin** `syncedFromCloud: true` mirror row ko online rakhta hai
 * (Shared Companies Local hide ke baad online shared galat "local" ban kar gayab na ho).
 */
export function isOfflineCompanyStorage(c: CompanyStorageRow): boolean {
  return !isCloudLinkedCompanyStorage(c);
}

/** Shared + cloud (Firebase) — unlock: Company Profile `adminUsername` + root `password` */
export function isOnlineSharedCompany(c: CompanyUnlockRow): boolean {
  return !c.isOwned && !isOfflineCompanyStorage(c);
}

/** Unlock verify ke liye: `adminUsername` ya owner email ka prefix (local login jaisa fallback). */
export function effectiveCompanyAdminUsername(company: CompanyUnlockRow): string {
  let u = String((company as { adminUsername?: string | null }).adminUsername ?? "").trim();
  if (u) return u;
  const oe = String(company.ownerEmail ?? "").trim();
  if (oe.includes("@")) return oe.split("@")[0].trim();
  return "";
}

export function getShareEntryForEmail(company: CompanyUnlockRow, email: string | undefined | null) {
  if (!email) return undefined;
  const e = email.toLowerCase().trim();
  return company.sharedWith?.find((u: { email?: string }) => String(u.email || "").toLowerCase().trim() === e);
}

/**
 * Password set? Plain text (Firebase copy) ya Pocket Ledger Server ka `hasPassword` marker
 * (server sirf bcrypt hash rakhta hai, text nahi).
 */
export function shareEntryHasPassword(se: unknown): boolean {
  if (!se || typeof se !== "object") return false;
  const o = se as { password?: unknown; hasPassword?: unknown };
  if (o.password != null && String(o.password).trim() !== "") return true;
  return o.hasPassword === true;
}

/** Company root (Protect company) password set? — plain text ya server marker. */
export function companyRootHasPassword(company: unknown): boolean {
  if (!company || typeof company !== "object") return false;
  const o = company as { password?: unknown; hasPassword?: unknown };
  if (String(o.password ?? "").trim()) return true;
  return o.hasPassword === true;
}

/** Online shared row par user-specific password (Manage Sharing / Company Profile) — Protect company ke alag. */
export function onlineSharedHasPerUserPassword(company: CompanyUnlockRow, userEmail?: string | null): boolean {
  if (!isOnlineSharedCompany(company)) return false;
  return shareEntryHasPassword(getShareEntryForEmail(company, userEmail));
}

/** Offline company me `localCompanyUsers` rows — bina Protect company password ke bhi login chahiye. */
export function offlineCompanyHasLocalLoginUsers(company: unknown): boolean {
  if (!company || typeof company !== "object") return false;
  return parseLocalCompanyUserRows((company as { localCompanyUsers?: unknown }).localCompanyUsers).length > 0;
}

/**
 * Local / server-gate company: unlock sirf is app user ke liye jab unki row / protect password ho.
 * Owner ko staff rows ki wajah se prompt nahi — sirf jab owner ne khud password set kiya ho.
 */
export function localCompanyAppUserRequiresUnlock(
  company: unknown,
  appUser?: { uid?: string | null; email?: string | null; isOwner?: boolean }
): boolean {
  if (!company || typeof company !== "object") return false;
  const row = company as CompanyUnlockRow & { localCompanyUsers?: unknown; driveSharedJoin?: unknown };
  if (isDriveSharedLocalJoinRow(row)) return true;

  const isOwner = appUser?.isOwner === true;
  const users = parseLocalCompanyUserRows(row.localCompanyUsers);
  const userRow = findLocalCompanyUserRowForAppUser(users, appUser?.uid, appUser?.email);

  if (isOwner) {
    if (userRow?.password?.trim()) return true;
    if (companyRootHasPassword(row)) return true;
    return false;
  }

  if (userRow?.password?.trim()) return true;
  const se = getShareEntryForEmail(row, appUser?.email);
  if (shareEntryHasPassword(se)) return true;
  if (companyRootHasPassword(row) && !userRow) return true;
  return false;
}

/** Drive se shared join — Select / login se pehle company unlock check. */
export function isDriveSharedLocalJoinRow(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return (row as { driveSharedJoin?: unknown }).driveSharedJoin === true;
}

/** SQLite / list row: koi bhi unlock (password, local users, shared user password) zaroori hai? */
export function companyDocRequiresUnlock(
  doc: unknown,
  userEmail?: string | null,
  firebaseUid?: string | null,
  isOwnedHint?: boolean
): boolean {
  if (!doc || typeof doc !== "object") return false;
  const row = doc as CompanyUnlockRow & { localCompanyUsers?: unknown; driveSharedJoin?: unknown };
  if (isDriveSharedLocalJoinRow(row)) return true;

  const isLocalLedgerRow = isOfflineCompanyStorage(row) || isServerGateCompany(row);
  if (isLocalLedgerRow) {
    const isOwner =
      isOwnedHint === true ||
      isCurrentUserOwnerOfCompanyRow(row, { uid: String(firebaseUid || "").trim(), email: userEmail ?? null });
    return localCompanyAppUserRequiresUnlock(doc, { uid: firebaseUid, email: userEmail, isOwner });
  }

  if (companyRootHasPassword(row)) return true;
  if (offlineCompanyHasLocalLoginUsers(row)) return true;
  return shareEntryHasPassword(getShareEntryForEmail(row, userEmail));
}

/** Select se pehle dialog dikhana hai ya nahi (remembered session check async path me). */
export function shouldPromptCompanyUnlock(
  company: CompanyUnlockRow,
  userEmail?: string | null,
  firebaseUid?: string | null
): boolean {
  if (isServerGateCompany(company)) {
    const explicit = (company as { requiresLogin?: boolean }).requiresLogin;
    // Host access-context flag — client shell pe localCompanyUsers na hone par bhi login chahiye.
    if (explicit === true) return true;
    if (explicit === false) return false;
    if (companyDocRequiresUnlock(company, userEmail, firebaseUid, company.isOwned)) return true;
    // PL shared company: passwordless open mat do jab tak host ne explicitly requiresLogin:false na bheja.
    return true;
  }
  if (isOnlineSharedCompany(company)) {
    return companyRootHasPassword(company) || onlineSharedHasPerUserPassword(company, userEmail);
  }
  if (isOfflineCompanyStorage(company)) {
    return companyDocRequiresUnlock(company, userEmail, firebaseUid, company.isOwned);
  }
  const se = getShareEntryForEmail(company, userEmail || undefined);
  return shareEntryHasPassword(se) || companyRootHasPassword(company);
}

/** List row slim ho to SQLite se local users check — unlock dialog ke liye. */
export async function shouldPromptCompanyUnlockAsync(
  company: CompanyUnlockRow,
  userEmail?: string | null,
  firebaseUid?: string,
  /** Drive shared panel Select — remembered session ignore karke hamesha dialog. */
  forcePrompt?: boolean
): Promise<boolean> {
  const id = String(company.id || "").trim();
  if (!forcePrompt && id) {
    if (hasValidStoredOfflineUnlockSession(firebaseUid, id, userEmail)) return false;
    if (!isOfflineCompanyStorage(company) && readCloudCompanyPasswordUnlockSession(firebaseUid, id, userEmail)) {
      return false;
    }
  }
  if (shouldPromptCompanyUnlock(company, userEmail, firebaseUid)) return true;
  if (!company.id) return false;
  try {
    const doc = await getLocalCompanyById(company.id, { includeDeleted: true });
    if (!doc) return false;
    const isOwned =
      company.isOwned === true ||
      isCurrentUserOwnerOfCompanyRow(doc, { uid: String(firebaseUid || "").trim(), email: userEmail ?? null });
    if (isServerGateCompany(company) || isServerGateCompany(doc)) {
      return companyDocRequiresUnlock(doc, userEmail, firebaseUid, isOwned);
    }
    if (!isOfflineCompanyStorage(company)) return false;
    return companyDocRequiresUnlock(doc, userEmail, firebaseUid, isOwned);
  } catch {
    return false;
  }
}

/** Username field: online shared jab Protect on ho ya shared user ka apna password ho; offline shared jab share row me name+password ho */
export function showCompanyUserNameField(company: CompanyUnlockRow, userEmail?: string | null, firebaseUid?: string | null): boolean {
  if (isServerGateCompany(company)) {
    return shouldPromptCompanyUnlock(company, userEmail, firebaseUid);
  }
  if (isOnlineSharedCompany(company)) {
    return companyRootHasPassword(company) || onlineSharedHasPerUserPassword(company, userEmail);
  }
  if (isOfflineCompanyStorage(company)) {
    return companyDocRequiresUnlock(company, userEmail, firebaseUid, company.isOwned);
  }
  const se = getShareEntryForEmail(company, userEmail || undefined);
  return shareEntryHasPassword(se) && !!String((se as { name?: string }).name || "").trim();
}

/**
 * Company access verify: owner = root password; online shared = shared row email/name + per-user password,
 * ya (Protect on ho to) Admin username + root password fallback.
 */
export function verifyCompanyUnlock(
  company: CompanyUnlockRow,
  userEmail: string | undefined,
  usernameInput: string,
  passwordInput: string
): { ok: true } | { ok: false; message: string } {
  const se = getShareEntryForEmail(company, userEmail);

  const isOwner = company.isOwned === true;

  // Server-only password (hash on Pocket Ledger Server, no text on this device): yahan check
  // nahi ho sakta — `verifyCompanyUnlockAsync` server se check karta hai.
  const rootPlain = String(company.password ?? "").trim() !== "";
  const sePlain = !!se && se.password != null && String(se.password).trim() !== "";
  if ((!rootPlain && companyRootHasPassword(company)) || (!sePlain && shareEntryHasPassword(se))) {
    return { ok: false, message: SERVER_CHECK_UNAVAILABLE };
  }

  // Owner: sirf root company password (shared user password alag)
  if (isOwner && company.password && !se?.password) {
    if (passwordInput !== company.password) return { ok: false, message: "Wrong company password." };
    return { ok: true };
  }

  if (isOnlineSharedCompany(company)) {
    if (!se) return { ok: false, message: "No share entry for your account." };

    const sharedPassRaw = se.password;
    const sharedPass =
      sharedPassRaw != null && String(sharedPassRaw).trim() !== "" ? String(sharedPassRaw) : "";

    /** Per-shared-user password: login = same Google email, display name, ya email ka @ se pehle wala hissa. */
    const verifyPerUserSharedUnlock = (): { ok: true } | { ok: false; message: string } => {
      if (!sharedPass) return { ok: false, message: "Wrong company username or password." };
      const u = usernameInput.trim().toLowerCase();
      const emailNorm = String(se.email || "").toLowerCase().trim();
      const nameNorm = String((se as { name?: string }).name || "").trim().toLowerCase();
      const localFromEmail =
        emailNorm.includes("@") ? emailNorm.split("@")[0]!.trim().toLowerCase() : "";
      const userOk =
        (!!emailNorm && u === emailNorm) ||
        (!!localFromEmail && u === localFromEmail) ||
        (!!nameNorm && u === nameNorm);
      if (!userOk || passwordInput !== sharedPass) {
        return { ok: false, message: "Wrong company username or password." };
      }
      return { ok: true };
    };

    if (!company.password) {
      if (sharedPass) return verifyPerUserSharedUnlock();
      return { ok: true };
    }

    if (sharedPass) {
      const per = verifyPerUserSharedUnlock();
      if (per.ok) return per;
      const adminLogin = effectiveCompanyAdminUsername(company);
      if (
        adminLogin &&
        usernameInput.trim().toLowerCase() === adminLogin.toLowerCase() &&
        passwordInput === String(company.password)
      ) {
        return { ok: true };
      }
      return { ok: false, message: "Wrong company username or password." };
    }

    const adminLogin = effectiveCompanyAdminUsername(company);
    if (!adminLogin) {
      return {
        ok: false,
        message: "Owner must set Admin username (Company Profile) before shared users can unlock with password.",
      };
    }
    const nameOk = usernameInput.trim().toLowerCase() === adminLogin.toLowerCase();
    const passOk = passwordInput === String(company.password);
    if (!nameOk || !passOk) return { ok: false, message: "Wrong company username or password." };
    return { ok: true };
  }

  if (se?.password) {
    if (showCompanyUserNameField(company, userEmail)) {
      const nameOk = usernameInput.trim().toLowerCase() === String((se as { name?: string }).name || "").trim().toLowerCase();
      const passOk = passwordInput === se.password;
      if (!nameOk || !passOk) return { ok: false, message: "Wrong company user name or password." };
      return { ok: true };
    }
    if (passwordInput !== se.password) return { ok: false, message: "Incorrect password." };
    return { ok: true };
  }

  if (company.password && !isOwner) {
    if (passwordInput !== company.password) return { ok: false, message: "Incorrect password." };
    return { ok: true };
  }

  return { ok: true };
}

const SERVER_CHECK_UNAVAILABLE =
  "Company password could not be checked: connect to Pocket Ledger Server and try again.";

/**
 * Unlock verify — Pocket Ledger Server company: password server pe (bcrypt hash) check hota hai;
 * server pe password na ho ("none") to purana device check (`verifyCompanyUnlock`).
 * Firebase company: seedha `verifyCompanyUnlock` (unchanged).
 */
export async function verifyCompanyUnlockAsync(
  company: CompanyUnlockRow,
  userEmail: string | undefined,
  usernameInput: string,
  passwordInput: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = String(company.id || "").trim();
  let isPb = false;
  try {
    const { isPocketBaseCompanyId } = await import("@/lib/pocketbaseData/pbCompanyRegistry");
    isPb = !!id && isPocketBaseCompanyId(id);
  } catch {
    isPb = false;
  }
  if (isPb) {
    try {
      const { pbCompanyUnlock } = await import("@/lib/pocketbaseData/pbSync");
      const r = await pbCompanyUnlock(id, usernameInput.trim(), passwordInput);
      if (r.status === "ok") return { ok: true };
      if (r.status === "wrong" || r.status === "locked") return { ok: false, message: r.message };
    } catch {
      /* server check unavailable -> device check below */
    }
  }
  return verifyCompanyUnlock(company, userEmail, usernameInput, passwordInput);
}

/** Bina password/local users — SQLite se seedha open; vouchers ke liye lightweight session. */
export function grantOpenLocalCompanySession(
  companyId: string,
  options?: { role?: "owner" | "viewer" | "manager" }
): void {
  const id = String(companyId || "").trim();
  if (!id || getLocalAuthToken(id)) return;
  const role = options?.role === "owner" ? "owner" : options?.role === "manager" ? "manager" : "viewer";
  setLocalAuthToken(id, `local_open_${id}_${Date.now()}`, {
    id: role === "owner" ? "local_open_owner" : "local_open",
    username: role === "owner" ? "owner" : role,
    displayName: role === "owner" ? "Owner" : role === "manager" ? "Manager" : "Viewer",
    role,
  });
}
