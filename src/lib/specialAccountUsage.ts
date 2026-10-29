import { PermissionGroups, type Permission } from "@/lib/permissions";
import type { PermissionConfig, UserRole } from "@/hooks/usePermissions";
import type { Company } from "@/hooks/useCompany";

export type SpecialAccountUseFor = {
  in: string[];
  out: string[];
  balance: string[];
};

export const EMPTY_SPECIAL_ACCOUNT_USE_FOR: SpecialAccountUseFor = {
  in: [],
  out: [],
  balance: [],
};

const flattenedPermissions = PermissionGroups.flatMap((g) => g.permissions.map((p) => p.key));

export const VIEW_SPECIAL_BANK_ACCOUNTS_PERM: Permission = "view_special_bank_accounts";
export const MANAGE_SPECIAL_BANK_ACCOUNTS_PERM: Permission = "manage_special_bank_accounts";
export const VIEW_SPECIAL_ACCOUNT_BALANCE_PERM: Permission = "view_special_account_balance";

export function permissionKeyIndex(key: Permission): number {
  return flattenedPermissions.indexOf(key);
}

export function normalizeSpecialAccountUseFor(raw: unknown): SpecialAccountUseFor {
  if (!raw || typeof raw !== "object") return { ...EMPTY_SPECIAL_ACCOUNT_USE_FOR };
  const row = raw as Partial<SpecialAccountUseFor>;
  const pick = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];
  return {
    in: pick(row.in),
    out: pick(row.out),
    balance: pick(row.balance),
  };
}

export function specialAccountUseForHasAnySelection(useFor: SpecialAccountUseFor): boolean {
  return useFor.in.length > 0 || useFor.out.length > 0 || useFor.balance.length > 0;
}

/** Map stored ids (uid / email / casing) → table user ids (email keys). */
export function canonicalizeSpecialAccountUseForForCompany(
  raw: unknown,
  company: Company | null
): SpecialAccountUseFor {
  const base = normalizeSpecialAccountUseFor(raw);
  const users = listSpecialAccountAccessUsers(company);
  const canon = new Map<string, string>();
  for (const u of users) {
    const id = String(u.id || "").trim();
    if (id) canon.set(id.toLowerCase(), id);
  }
  const ownerEmail = String(company?.ownerEmail || "").trim();
  const ownerId = String(company?.ownerId || "").trim();
  if (ownerEmail) canon.set(ownerEmail.toLowerCase(), ownerEmail);
  if (ownerId) canon.set(ownerId.toLowerCase(), ownerEmail || ownerId);

  const mapIds = (list: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of list) {
      const trimmed = String(x || "").trim();
      if (!trimmed) continue;
      const resolved = canon.get(trimmed.toLowerCase()) ?? trimmed;
      const key = resolved.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(resolved);
      }
    }
    return out;
  };

  return { in: mapIds(base.in), out: mapIds(base.out), balance: mapIds(base.balance) };
}

/** Manage Sharing / bank edit — per-account useFor, else company usage defaults. */
export function resolveSpecialAccountUseForForDisplay(
  account: { useFor?: unknown } | null | undefined,
  config: PermissionConfig | null | undefined,
  company: Company | null
): SpecialAccountUseFor {
  const fromAccount = canonicalizeSpecialAccountUseForForCompany(account?.useFor, company);
  if (specialAccountUseForHasAnySelection(fromAccount)) return fromAccount;
  return canonicalizeSpecialAccountUseForForCompany(
    readSpecialAccountUsageDefaults(config),
    company
  );
}

export function specialAccountUseForIncludesUser(
  list: string[] | undefined,
  userId: string
): boolean {
  const id = String(userId || "").trim().toLowerCase();
  if (!id) return false;
  return (list || []).some((x) => String(x || "").trim().toLowerCase() === id);
}

export function readSpecialAccountUsageDefaults(
  config: PermissionConfig | null | undefined
): SpecialAccountUseFor {
  const raw = (config as { specialAccountUsageDefaults?: unknown } | null | undefined)
    ?.specialAccountUsageDefaults;
  return normalizeSpecialAccountUseFor(raw);
}

export function mergeSpecialAccountUsageIntoPermissionConfig(
  config: PermissionConfig,
  useFor: SpecialAccountUseFor,
  _users: SpecialAccountAccessUser[]
): PermissionConfig {
  return {
    ...config,
    roles: { ...config.roles },
    specialAccountUsageDefaults: normalizeSpecialAccountUseFor(useFor),
  };
}

export type SpecialAccountAccessUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  photoURL?: string | null;
  role?: string;
};

/** Same identity keys as bank account dialogs (email as id). */
export function listSpecialAccountAccessUsers(company: Company | null): SpecialAccountAccessUser[] {
  if (!company) return [];
  const ownerEmail = String(company.ownerEmail || "").trim();
  const ownerUser: SpecialAccountAccessUser = {
    id: ownerEmail,
    email: ownerEmail,
    name: "Owner",
    photoURL: null,
    role: "owner",
  };
  const sharedUsers = (company.sharedWith || []).map((u) => ({
    id: String(u.email || "").trim(),
    email: u.email,
    name: u.name || "Unknown",
    photoURL: u.photoURL || null,
    role: u.role,
  }));
  const map = new Map<string, SpecialAccountAccessUser>();
  if (ownerUser.id) map.set(ownerUser.id, ownerUser);
  for (const u of sharedUsers) {
    if (u.id && !map.has(u.id)) map.set(u.id, u);
  }
  return Array.from(map.values());
}

function roleKey(raw: unknown): UserRole | null {
  const n = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
  if (n === "admin" || n === "administrator") return "manager";
  if (["viewer", "data-entry", "accountant", "editor", "manager", "owner"].includes(n)) {
    return n as UserRole;
  }
  return null;
}

/** @deprecated Usage table balance column only — no role bit sync. Kept for old configs. */
export function syncRoleBalancePermissionsFromUsage(
  config: PermissionConfig,
  users: SpecialAccountAccessUser[]
): PermissionConfig {
  return config;
}

export function applyBalancePermissionToggleForRole(
  config: PermissionConfig,
  role: UserRole,
  checked: boolean,
  users: SpecialAccountAccessUser[]
): PermissionConfig {
  const usage = readSpecialAccountUsageDefaults(config);
  const memberIds = users
    .filter((u) => roleKey(u.role) === role)
    .map((u) => String(u.id || "").trim())
    .filter(Boolean);
  const balanceSet = new Set(usage.balance.map((x) => x.toLowerCase()));
  for (const id of memberIds) {
    const key = id.toLowerCase();
    if (checked) balanceSet.add(key);
    else balanceSet.delete(key);
  }
  usage.balance = users
    .map((u) => String(u.id || "").trim())
    .filter((id) => balanceSet.has(id.toLowerCase()));
  return mergeSpecialAccountUsageIntoPermissionConfig(config, usage, users);
}

export function userIsSpecialAccountOwner(
  userId: string,
  company: { ownerId?: string; ownerEmail?: string | null } | null | undefined
): boolean {
  const id = String(userId || "").trim();
  if (!id || !company) return false;
  if (id === String(company.ownerId || "").trim()) return true;
  const ownerEmail = String(company.ownerEmail || "").trim();
  return ownerEmail && id.toLowerCase() === ownerEmail.toLowerCase();
}

/** Manage Sharing — host configures usage table (not tied to view/manage role pair). */
export function roleSpecialAccountSwitchEnabled(
  role: UserRole,
  rolePermissions: boolean[]
): boolean {
  if (role === "owner") return true;
  const manageIdx = permissionKeyIndex(MANAGE_SPECIAL_BANK_ACCOUNTS_PERM);
  return manageIdx >= 0 && rolePermissions[manageIdx] === true;
}

export function applySpecialAccountSwitchToggleForRole(
  config: PermissionConfig,
  role: UserRole,
  enabled: boolean,
  users: SpecialAccountAccessUser[]
): PermissionConfig {
  if (role === "owner") return config;
  const next: PermissionConfig = {
    ...config,
    roles: { ...config.roles },
    specialAccountUsageDefaults: readSpecialAccountUsageDefaults(config),
  };
  const manageIdx = permissionKeyIndex(MANAGE_SPECIAL_BANK_ACCOUNTS_PERM);
  const row = [...(next.roles[role] || [])];
  if (manageIdx >= 0) row[manageIdx] = enabled;
  next.roles[role] = row;
  if (!enabled) {
    return applyBalancePermissionToggleForRole(next, role, false, users);
  }
  return next;
}

/** No-op: manage and view special are independent (checkbox handler sets one bit only). */
export function syncSpecialAccountPermissionPair(
  config: PermissionConfig,
  role: UserRole,
  permissionKey: Permission,
  checked: boolean
): PermissionConfig {
  if (role === "owner") return config;
  const idx = permissionKeyIndex(permissionKey);
  if (idx < 0) return config;
  const row = [...(config.roles[role] || [])];
  row[idx] = checked;
  return { ...config, roles: { ...config.roles, [role]: row } };
}

function resolvedUseForOnAccount(
  account: { isSpecial?: boolean; useFor?: Partial<SpecialAccountUseFor> | null }
): SpecialAccountUseFor {
  return normalizeSpecialAccountUseFor(account?.useFor);
}

/** Payment In — usage table Payment In column only (+ owner). */
export function specialAccountAllowsPaymentIn(
  account: { isSpecial?: boolean; useFor?: Partial<SpecialAccountUseFor> | null },
  userEmail: string | null | undefined,
  isOwner: boolean
): boolean {
  if (!account.isSpecial) return true;
  if (isOwner) return true;
  const usage = resolvedUseForOnAccount(account);
  return specialAccountUseForIncludesUser(usage.in, userEmail || "");
}

/** Payment — usage table Payment column only (+ owner). */
export function specialAccountAllowsPaymentOut(
  account: { isSpecial?: boolean; useFor?: Partial<SpecialAccountUseFor> | null },
  userEmail: string | null | undefined,
  isOwner: boolean
): boolean {
  if (!account.isSpecial) return true;
  if (isOwner) return true;
  const usage = resolvedUseForOnAccount(account);
  return specialAccountUseForIncludesUser(usage.out, userEmail || "");
}

/** Bank list + ledger balance — usage table View Balance tick only (+ owner). Role/manage perms do not apply. */
export function userCanViewSpecialAccountBalance(
  account: { isSpecial?: boolean; useFor?: Partial<SpecialAccountUseFor> | null },
  userEmail: string | null | undefined,
  isOwner: boolean
): boolean {
  if (!account.isSpecial) return true;
  if (isOwner) return true;
  const email = String(userEmail || "").trim();
  if (!email) return false;
  const usage = resolvedUseForOnAccount(account);
  return specialAccountUseForIncludesUser(usage.balance, email);
}
