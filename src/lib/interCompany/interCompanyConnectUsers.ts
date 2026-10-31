/**
 * Inter Company — Connect User tab: email + IC-only visibility permissions.
 * Firestore: companies/{companyId}/inter_company_config/connect_users
 */
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { doc, serverTimestamp, type Unsubscribe } from "@/lib/pbCompat/firestore";
import { getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import { isPureLocalInterCompanyCompany } from "@/lib/interCompany/localInterCompanyPolicy";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

function normalizeConnectUserEmail(email: string | null | undefined): string {
  return String(email || "").trim().toLowerCase();
}

/** Manage Sharing invite list (not owner) — Connect User hide rules inapplicable jab ye true ho. */
export function isEmailOnCompanyManageSharingList(
  company:
    | {
        ownerEmail?: string | null;
        sharedWith?: Array<{ email?: string | null }>;
        sharedWithEmails?: unknown;
      }
    | null
    | undefined,
  email: string | null | undefined
): boolean {
  const normalized = normalizeConnectUserEmail(email);
  if (!normalized || !company) return false;
  const owner = normalizeConnectUserEmail(company.ownerEmail);
  if (owner && normalized === owner) return false;
  if (Array.isArray(company.sharedWith)) {
    for (const entry of company.sharedWith) {
      if (normalizeConnectUserEmail(entry?.email) === normalized) return true;
    }
  }
  for (const raw of Array.isArray(company.sharedWithEmails) ? company.sharedWithEmails : []) {
    if (normalizeConnectUserEmail(String(raw || "")) === normalized) return true;
  }
  return false;
}

export type InterCompanyConnectMasterKind = InterCompanyEntityKind;

export type InterCompanyConnectMasterVisibility = Record<InterCompanyConnectMasterKind, boolean>;

export type InterCompanyConnectUserEntry = {
  id: string;
  email: string;
  name?: string;
  /** Default ON — shared user ko IC me company name dikhe */
  showCompanyName: boolean;
  /** ON → masterVisibility sub-options apply */
  showMasters: boolean;
  masterVisibility: InterCompanyConnectMasterVisibility;
  createdAt?: string;
  updatedAt?: string;
};

export const IC_CONNECT_MASTER_LABELS: Record<InterCompanyConnectMasterKind, string> = {
  party: "Show party name",
  bank: "Show bank name",
  staff: "Show loan & staff",
  tax: "Show tax account",
  expense: "Show income & expense ledger",
};

export const IC_CONNECT_MASTER_ORDER: InterCompanyConnectMasterKind[] = [
  "party",
  "bank",
  "staff",
  "tax",
  "expense",
];

export function defaultInterCompanyConnectMasterVisibility(): InterCompanyConnectMasterVisibility {
  return {
    party: true,
    bank: true,
    staff: true,
    tax: true,
    expense: true,
  };
}

export function normalizeConnectMasterVisibility(
  raw: Partial<InterCompanyConnectMasterVisibility> | undefined
): InterCompanyConnectMasterVisibility {
  const base = defaultInterCompanyConnectMasterVisibility();
  if (!raw) return base;
  for (const key of IC_CONNECT_MASTER_ORDER) {
    if (typeof raw[key] === "boolean") base[key] = raw[key]!;
  }
  return base;
}

function normalizeEntry(raw: Record<string, unknown>): InterCompanyConnectUserEntry | null {
  const email = String(raw.email || "")
    .trim()
    .toLowerCase();
  if (!email) return null;
  const id = String(raw.id || "").trim() || `icu-${email.replace(/[^a-z0-9]/g, "-")}`;
  return {
    id,
    email,
    name: String(raw.name || "").trim() || undefined,
    showCompanyName: raw.showCompanyName !== false,
    showMasters: raw.showMasters === true,
    masterVisibility: normalizeConnectMasterVisibility(
      raw.masterVisibility as Partial<InterCompanyConnectMasterVisibility>
    ),
    createdAt: String(raw.createdAt || "").trim() || undefined,
    updatedAt: String(raw.updatedAt || "").trim() || undefined,
  };
}

const LOCAL_KEY = (companyId: string) => `pl-inter-company-connect-users::${companyId}`;

function connectUsersDocRef(companyId: string) {
  return doc(firestore, "companies", companyId, "inter_company_config", "connect_users");
}

function readLocalConnectUsers(companyId: string): InterCompanyConnectUserEntry[] {
  if (typeof window === "undefined" || !companyId) return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY(companyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { users?: unknown[] };
    if (!Array.isArray(parsed.users)) return [];
    return parsed.users
      .map((u) => (u && typeof u === "object" ? normalizeEntry(u as Record<string, unknown>) : null))
      .filter(Boolean) as InterCompanyConnectUserEntry[];
  } catch {
    return [];
  }
}

function writeLocalConnectUsers(companyId: string, users: InterCompanyConnectUserEntry[]): void {
  if (typeof window === "undefined" || !companyId) return;
  try {
    localStorage.setItem(LOCAL_KEY(companyId), JSON.stringify({ users }));
  } catch {
    /* ignore */
  }
}

export function newInterCompanyConnectUserEntry(email: string): InterCompanyConnectUserEntry {
  const normalized = email.trim().toLowerCase();
  const now = new Date().toISOString();
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `icu-${Date.now()}`,
    email: normalized,
    showCompanyName: true,
    showMasters: true,
    masterVisibility: defaultInterCompanyConnectMasterVisibility(),
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadInterCompanyConnectUsers(
  companyId: string
): Promise<InterCompanyConnectUserEntry[]> {
  if (!companyId) return [];
  if (await isPureLocalInterCompanyCompany(companyId)) {
    return readLocalConnectUsers(companyId);
  }
  try {
    const snap = await getDoc(connectUsersDocRef(companyId));
    if (!snap.exists()) return readLocalConnectUsers(companyId);
    const data = snap.data() as { users?: unknown[] };
    const users = Array.isArray(data.users)
      ? (data.users
          .map((u) => (u && typeof u === "object" ? normalizeEntry(u as Record<string, unknown>) : null))
          .filter(Boolean) as InterCompanyConnectUserEntry[])
      : [];
    writeLocalConnectUsers(companyId, users);
    return users;
  } catch {
    return readLocalConnectUsers(companyId);
  }
}

export function subscribeInterCompanyConnectUsers(
  companyId: string,
  onData: (users: InterCompanyConnectUserEntry[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  if (!isInterCompanySystemEnabled() || !companyId) {
    onData([]);
    return () => undefined;
  }

  let cancelled = false;
  let firestoreUnsub: Unsubscribe = () => undefined;

  void (async () => {
    if (await isPureLocalInterCompanyCompany(companyId)) {
      if (!cancelled) onData(readLocalConnectUsers(companyId));
      return;
    }
    if (cancelled) return;
    firestoreUnsub = onSnapshot(
      connectUsersDocRef(companyId),
      (snap) => {
        if (!snap.exists()) {
          onData(readLocalConnectUsers(companyId));
          return;
        }
        const data = snap.data() as { users?: unknown[] };
        const users = Array.isArray(data.users)
          ? (data.users
              .map((u) =>
                u && typeof u === "object" ? normalizeEntry(u as Record<string, unknown>) : null
              )
              .filter(Boolean) as InterCompanyConnectUserEntry[])
          : [];
        writeLocalConnectUsers(companyId, users);
        onData(users);
      },
      (err) => onError?.(err)
    );
  })();

  return () => {
    cancelled = true;
    firestoreUnsub();
  };
}

function serializeConnectUserEntry(u: InterCompanyConnectUserEntry): InterCompanyConnectUserEntry {
  const entry: InterCompanyConnectUserEntry = {
    id: u.id,
    email: u.email.trim().toLowerCase(),
    showCompanyName: u.showCompanyName !== false,
    showMasters: u.showMasters === true,
    masterVisibility: normalizeConnectMasterVisibility(u.masterVisibility),
    updatedAt: new Date().toISOString(),
  };
  const name = String(u.name || "").trim();
  if (name) entry.name = name;
  if (u.createdAt) entry.createdAt = u.createdAt;
  return entry;
}

export async function saveInterCompanyConnectUsers(args: {
  companyId: string;
  users: InterCompanyConnectUserEntry[];
  updatedByUid: string;
  hostCompanyName?: string;
}): Promise<void> {
  const { companyId, updatedByUid } = args;
  const previousUsers = await loadInterCompanyConnectUsers(companyId);
  const users = args.users.map(serializeConnectUserEntry);
  writeLocalConnectUsers(companyId, users);
  const { syncConnectUserInvitesForCompany } = await import(
    "@/lib/interCompany/interCompanyConnectUserInvites"
  );
  await syncConnectUserInvitesForCompany({
    companyId,
    users,
    hostCompanyName: args.hostCompanyName,
    previousUsers,
  });
  if (await isPureLocalInterCompanyCompany(companyId)) return;
  await setDoc(
    connectUsersDocRef(companyId),
    {
      companyId,
      users,
      updatedByUid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Current user email → connect entry on this company (owner/admin = null = full access). */
export function findInterCompanyConnectUserEntry(
  users: InterCompanyConnectUserEntry[],
  email: string | null | undefined
): InterCompanyConnectUserEntry | null {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  if (!e) return null;
  return users.find((u) => u.email === e) ?? null;
}

export type InterCompanyConnectUserAccess = {
  /** Owner / admin / not in connect list */
  isFullAccess: boolean;
  showCompanyName: boolean;
  showMasters: boolean;
  masterVisibility: InterCompanyConnectMasterVisibility;
  /** Source account list hidden — suggested name only */
  sourceAccountListRestricted: boolean;
};

export function fullInterCompanyConnectUserAccess(): InterCompanyConnectUserAccess {
  return {
    isFullAccess: true,
    showCompanyName: true,
    showMasters: true,
    masterVisibility: defaultInterCompanyConnectMasterVisibility(),
    sourceAccountListRestricted: false,
  };
}

export function connectAccessFromConnectUserEntry(
  entry: InterCompanyConnectUserEntry
): InterCompanyConnectUserAccess {
  const masterVisibility = normalizeConnectMasterVisibility(entry.masterVisibility);
  const hasAnyMaster = IC_CONNECT_MASTER_ORDER.some((k) => masterVisibility[k] !== false);
  return {
    isFullAccess: false,
    showCompanyName: entry.showCompanyName !== false,
    showMasters: hasAnyMaster,
    masterVisibility,
    sourceAccountListRestricted: !hasAnyMaster,
  };
}

export function connectAccessFromInviteGrant(
  grant: {
    showCompanyName?: boolean;
    showMasters?: boolean;
    masterVisibility?: Partial<InterCompanyConnectMasterVisibility>;
  } | null
  | undefined
): InterCompanyConnectUserAccess | null {
  if (!grant) return null;
  return connectAccessFromConnectUserEntry({
    id: "invite",
    email: "",
    showCompanyName: grant.showCompanyName !== false,
    showMasters: grant.showMasters === true,
    masterVisibility: normalizeConnectMasterVisibility(grant.masterVisibility),
  });
}

export function allowedConnectMasterKinds(
  access: InterCompanyConnectUserAccess
): InterCompanyConnectMasterKind[] {
  if (access.isFullAccess) return [...IC_CONNECT_MASTER_ORDER];
  if (access.sourceAccountListRestricted) return [];
  return IC_CONNECT_MASTER_ORDER.filter((k) => access.masterVisibility[k] !== false);
}

export function isConnectMasterFullyAllowed(access: InterCompanyConnectUserAccess): boolean {
  if (access.isFullAccess) return true;
  if (access.sourceAccountListRestricted) return false;
  return IC_CONNECT_MASTER_ORDER.every((k) => access.masterVisibility[k] !== false);
}

export function resolveInterCompanyConnectUserAccess(args: {
  isCompanyOwnerOrAdmin: boolean;
  userEmail: string | null | undefined;
  connectUsers: InterCompanyConnectUserEntry[];
  /** Manage Sharing listed user — full masters (Connect User restrictions lose). */
  isManageSharingMember?: boolean;
  /** Host target grant — source company owner/admin par bhi connect list apply karo */
  ignoreOwnerAdminBypass?: boolean;
}): InterCompanyConnectUserAccess {
  const full = fullInterCompanyConnectUserAccess();
  if (args.isCompanyOwnerOrAdmin && !args.ignoreOwnerAdminBypass) return full;
  if (args.isManageSharingMember) return full;
  const entry = findInterCompanyConnectUserEntry(args.connectUsers, args.userEmail);
  if (!entry) return full;
  return connectAccessFromConnectUserEntry(entry);
}

/** Filter master entities for connect-user IC visibility. Clearing banks always pass through caller. */
export function filterInterCompanyEntitiesForConnectAccess<T extends {
  kind: InterCompanyConnectMasterKind;
  id: string;
  isClearing?: boolean;
}>(entities: T[], access: InterCompanyConnectUserAccess): T[] {
  if (access.isFullAccess) return entities;
  if (!access.showMasters) {
    return entities.filter((e) => e.kind === "bank" && e.isClearing === true);
  }
  return entities.filter((e) => {
    if (e.kind === "bank" && e.isClearing === true) return true;
    return access.masterVisibility[e.kind] === true;
  });
}
