
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  evaluateBackdatePermission,
  formatBackdatePermissionDeniedMessage,
  type CanPerformBackdatedFn,
} from "@/lib/permissions/enforcePermission";
import { useAuth } from "./useAuth";
import { useCompany } from "./useCompany";
import { Permission, PermissionGroups } from "@/lib/permissions";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { getLocalAuthToken, getLocalAuthUser, LOCAL_AUTH_CHANGED_EVENT } from "@/lib/localApiClient";
import { isLocalOnlyMode } from "@/lib/localMode";
import { resolvePlanIdForActiveCompany } from "@/lib/accountPlanForOwner";
import { resolveCompanyIsOwnedForUser } from "@/lib/companyOnlineIntegrity";
import { companyRowUsesSqliteLedgerWrites, isServerGateCompany, isServerSelectorCompanyRow } from "@/lib/companyStorageKind";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import { PL_SERVER_COMPANY_META_UPDATED_EVENT } from "@/lib/plServerCompanyMetaSync";
import { logPlPerm, resolvePermissionConfigSource, summarizePermissionDateLimits, companyUsesDeviceOrPlPermissionConfig, companyRolesAuthorityExcludesFirebase } from "@/lib/permissionConfigSource";
import { findLocalCompanyUserRowForAppUser, parseLocalCompanyUserRows } from "@/lib/localCompanyUsers";
import { normalizeLocalCompanyAppRole } from "@/lib/localCompanyAppRoles";
import { useAdWallet } from "@/hooks/useAdWallet";
import { normalizeSpecialAccountUseFor } from "@/lib/specialAccountUsage";
import { resolvePermissionRoleWithCache } from "@/lib/permissionRoleCache";

/** Offline company SQLite session — ye role Firebase owner se alag ho sakta hai (same email owner + staff login). */
function isLocalStorageCompany(c: { storageOption?: string } | null | undefined): boolean {
  return String(c?.storageOption || "local").toLowerCase() === "local";
}

/** PL server staff / gate mirror: local username session + host permissionConfig. */
function companyUsesLocalStaffPermissions(
  c: ({ storageOption?: string; plServerShared?: boolean } & Record<string, unknown>) | null | undefined
): boolean {
  if (!c) return isPlServerThinStaffClient();
  return (
    isLocalStorageCompany(c) ||
    isServerGateCompany(c) ||
    companyRowUsesSqliteLedgerWrites(c) ||
    isPlServerThinStaffClient()
  );
}

export function roleCanPermission(
  role: UserRole,
  permission: Permission,
  config: PermissionConfig = initialPermissionConfig
): boolean {
  if (role === "owner") return true;
  const index = flattenedPermissions.indexOf(permission);
  if (index === -1) return false;
  const storedRaw = config.roles[role];
  const storedRolePerms = Array.isArray(storedRaw) ? storedRaw : [];
  const defaultRolePerms = initialPermissionConfig.roles[role] || [];
  const rolePermissions = flattenedPermissions.map((_, i) =>
    i < storedRolePerms.length ? !!storedRolePerms[i] : !!defaultRolePerms[i]
  );
  return rolePermissions[index] || false;
}

export type UserRole = "viewer" | "data-entry" | "accountant" | "editor" | "manager" | "admin" | "owner";

export type DateLimits = {
    [key in UserRole]?: {
        entryDays: number;
        editDays: number;
        deleteDays: number;
    }
}

export type FileAttachmentLimits = {
    [key in UserRole]?: {
        maxFileCount: number; // 0 to 5
        allowImage: boolean;
        allowPDF: boolean;
        allowDelete: boolean;
    }
}

export type PermissionConfig = {
  permissions: Record<string, string[]>;
  roles: Record<UserRole, boolean[]>;
  dateLimits: DateLimits;
  fileAttachmentLimits?: FileAttachmentLimits;
  allowAttachments?: boolean; // Global toggle
  /** Company-wide special bank account Payment In/Out/Balance user allow-lists (synced with role balance perm). */
  specialAccountUsageDefaults?: import("@/lib/specialAccountUsage").SpecialAccountUseFor;
};

const flattenedPermissions = PermissionGroups.flatMap(g => g.permissions.map(p => p.key));

export const initialPermissionConfig: PermissionConfig = {
  permissions: PermissionGroups.reduce((acc, group) => {
    acc[group.title] = group.permissions.map(p => p.label);
    return acc;
  }, {} as Record<string, string[]>),
  // Role arrays: order matches flattenedPermissions (trailing block = Recurring Auto Voucher group).
  roles: {
    viewer:       [true, false, false, false, false, false, false, false, false, false, false, false, true, false, true, true, true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    // data-entry: manage_users_roles + configure_company_settings = false; recurring voucher strip allowed.
    "data-entry": [true, false, true, true, false, true, false, false, false, false, false, false, false, false, true, true, true, false, false, false, false, false, false, false, false, false, false, false, true, true, false, false, false, false, true, true, true, true, false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
    accountant:   [true, true, true, true, true, true, true, true, true, false, true, true, true, true, true, true, true, false, true, true, true, false, false, false, false, false, false, true, false, true, true, false, false, false, false, true, true, true, true, true, true, false, true, true, true, true, true, true, true, true, true, true, true, true],
    editor:       [true, true, true, true, true, true, true, true, true, false, true, true, true, true, true, true, true, false, true, true, true, false, false, false, false, false, false, true, false, true, true, false, false, false, false, true, true, true, true, true, true, false, true, true, true, true, true, true, true, true, true, true, true, true],
    manager:      [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
    // admin: full access (every permission) - only owner-only actions (delete company / transfer ownership) stay `role === "owner"`.
    admin: Array(flattenedPermissions.length).fill(true),
    owner: Array(flattenedPermissions.length).fill(true)
  },
  dateLimits: {
    viewer: { entryDays: 0, editDays: 0, deleteDays: 0 },
    "data-entry": { entryDays: 2, editDays: 0, deleteDays: 0 },
    accountant: { entryDays: 0, editDays: 7, deleteDays: 0 },
    editor: { entryDays: 3, editDays: 5, deleteDays: 5 },
    manager: { entryDays: 7, editDays: 7, deleteDays: 7 },
    admin: { entryDays: 9999, editDays: 9999, deleteDays: 9999 },
    owner: { entryDays: 9999, editDays: 9999, deleteDays: 9999 },
  },
  fileAttachmentLimits: {
    viewer: { maxFileCount: 0, allowImage: false, allowPDF: false, allowDelete: false },
    "data-entry": { maxFileCount: 3, allowImage: true, allowPDF: true, allowDelete: true },
    accountant: { maxFileCount: 5, allowImage: true, allowPDF: true, allowDelete: true },
    editor: { maxFileCount: 5, allowImage: true, allowPDF: true, allowDelete: true },
    manager: { maxFileCount: 5, allowImage: true, allowPDF: true, allowDelete: true },
    admin: { maxFileCount: 5, allowImage: true, allowPDF: true, allowDelete: true },
    owner: { maxFileCount: 5, allowImage: true, allowPDF: true, allowDelete: true },
  },
  allowAttachments: true,
};

function permissionRoleKey(raw: unknown): UserRole | null {
    const n = String(raw ?? "")
        .toLowerCase()
        .trim()
        .replace(/_/g, "-")
        .replace(/\s+/g, "-");
    if (n === "administrator" || n === "admin-role") return "manager";
    if (n === "super-admin" || n === "superadmin") return "owner";
    if (["viewer", "data-entry", "accountant", "editor", "manager", "admin", "owner"].includes(n)) {
        return n as UserRole;
    }
    return null;
}

/** Canonicalize legacy role names and deep-merge each role's persisted settings. */
export function normalizePermissionConfig(
    raw: PermissionConfig | Record<string, unknown> | null | undefined
): PermissionConfig {
    const source = raw && typeof raw === "object" ? raw as Partial<PermissionConfig> : {};
    const result = JSON.parse(JSON.stringify(initialPermissionConfig)) as PermissionConfig;
    result.permissions = {
        ...initialPermissionConfig.permissions,
        ...(source.permissions && typeof source.permissions === "object" ? source.permissions : {}),
    };
    result.allowAttachments = source.allowAttachments !== undefined
        ? source.allowAttachments !== false
        : initialPermissionConfig.allowAttachments;

    result.specialAccountUsageDefaults = normalizeSpecialAccountUseFor(
      (source as { specialAccountUsageDefaults?: unknown }).specialAccountUsageDefaults
    );

    for (const [storedRole, storedPermissions] of Object.entries(source.roles || {})) {
        const role = permissionRoleKey(storedRole);
        if (!role || !Array.isArray(storedPermissions)) continue;
        const defaults = initialPermissionConfig.roles[role] || [];
        result.roles[role] = flattenedPermissions.map((_, index) =>
            index < storedPermissions.length ? !!storedPermissions[index] : !!defaults[index]
        );
    }
    result.roles.owner = Array(flattenedPermissions.length).fill(true);

    for (const [storedRole, storedLimits] of Object.entries(source.dateLimits || {})) {
        const role = permissionRoleKey(storedRole);
        if (!role || !storedLimits || typeof storedLimits !== "object") continue;
        const limits = storedLimits as Partial<{ entryDays: number; editDays: number; deleteDays: number }>;
        const defaults = initialPermissionConfig.dateLimits[role] || { entryDays: 0, editDays: 0, deleteDays: 0 };
        result.dateLimits[role] = {
            entryDays: Number.isFinite(Number(limits.entryDays)) ? Number(limits.entryDays) : defaults.entryDays,
            editDays: Number.isFinite(Number(limits.editDays)) ? Number(limits.editDays) : defaults.editDays,
            deleteDays: Number.isFinite(Number(limits.deleteDays)) ? Number(limits.deleteDays) : defaults.deleteDays,
        };
    }

    for (const [storedRole, storedLimits] of Object.entries(source.fileAttachmentLimits || {})) {
        const role = permissionRoleKey(storedRole);
        if (!role || !storedLimits || typeof storedLimits !== "object") continue;
        const limits = storedLimits as Partial<{ maxFileCount: number; allowImage: boolean; allowPDF: boolean; allowDelete: boolean }>;
        const defaults = initialPermissionConfig.fileAttachmentLimits?.[role] || { maxFileCount: 0, allowImage: false, allowPDF: false, allowDelete: false };
        if (!result.fileAttachmentLimits) result.fileAttachmentLimits = {};
        result.fileAttachmentLimits[role] = {
            maxFileCount: Number.isFinite(Number(limits.maxFileCount)) ? Number(limits.maxFileCount) : defaults.maxFileCount,
            allowImage: limits.allowImage !== undefined ? limits.allowImage === true : defaults.allowImage,
            allowPDF: limits.allowPDF !== undefined ? limits.allowPDF === true : defaults.allowPDF,
            allowDelete: limits.allowDelete !== undefined ? limits.allowDelete === true : defaults.allowDelete,
        };
    }
    return result;
}


/** Local / server-gate / SQLite ledger — plan cache miss par bhi profile + doc attachments khulen. */
function localLikeCompanyForAttachments(c: { storageOption?: string; plServerShared?: boolean } | null | undefined): boolean {
  if (!c) return isLocalOnlyMode() || isPlServerThinStaffClient();
  if (isLocalStorageCompany(c)) return true;
  if (isServerGateCompany(c)) return true;
  if (companyRowUsesSqliteLedgerWrites(c)) return true;
  return isLocalOnlyMode() || isPlServerThinStaffClient();
}

const usePermissions = () => {
    const { customUser } = useAuth();
    const { company, allCompanies, localCompanyRegistryEpoch } = useCompany();
    const livePlans = useLivePlans();
    const { isFeatureTemporarilyUnlocked } = useAdWallet();
    const attachmentsAdUnlock = isFeatureTemporarilyUnlocked("attachments");
    /** Local unlock ke baad localStorage role turant useMemo me aaye (same-tab me storage event nahi aata). */
    const [localAuthEpoch, setLocalAuthEpoch] = useState(0);
    const [plServerMetaEpoch, setPlServerMetaEpoch] = useState(0);
    /** online/offline flips re-evaluate the cached-role verification (10-day offline grace). */
    const [onlineEpoch, setOnlineEpoch] = useState(0);
    useEffect(() => {
      const bump = () => setOnlineEpoch((n) => n + 1);
      window.addEventListener("online", bump);
      window.addEventListener("offline", bump);
      return () => {
        window.removeEventListener("online", bump);
        window.removeEventListener("offline", bump);
      };
    }, []);
    /** PL / local staff: host meta → client SQLite `permissionConfig` (server se har save pe verify nahi). */
    const [sqlitePermissionConfig, setSqlitePermissionConfig] = useState<PermissionConfig | null>(null);
    /** Host Manage Sharing users — assigned role My Role me session se pehle yahi. */
    const [sqliteLocalCompanyUsers, setSqliteLocalCompanyUsers] = useState<unknown>(null);
    /** Async reload / missing row pe default 7-day flash mat do — last good config sticky. */
    const sqlitePermissionStickyRef = useRef<{ companyId: string; config: PermissionConfig } | null>(null);
    const plPermLogSigRef = useRef<string>("");
    useEffect(() => {
      const onAuth = () => setLocalAuthEpoch((n) => n + 1);
      window.addEventListener(LOCAL_AUTH_CHANGED_EVENT, onAuth);
      return () => window.removeEventListener(LOCAL_AUTH_CHANGED_EVENT, onAuth);
    }, []);
    useEffect(() => {
      const onMeta = (event: Event) => {
        const detail = (event as CustomEvent<{
          companyId?: string;
          localCompanyUsers?: unknown;
        }>).detail;
        const eventCid = String(detail?.companyId || "").trim();
        const cid = String(company?.id || "").trim();
        if (eventCid && cid && eventCid !== cid) {
          // Live snapshot: host canonical id ≠ client slug — My Role tabhi update ho.
          const hostAlias = String(
            (company as { plServerHostCompanyId?: string } | null)?.plServerHostCompanyId ||
              (company as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId ||
              ""
          ).trim();
          if (eventCid !== hostAlias) return;
        }
        // Instant apply — async effect race se refresh-ke-baad-hi My Role mat dikhao.
        if (detail && "localCompanyUsers" in detail) {
          setSqliteLocalCompanyUsers(detail.localCompanyUsers ?? null);
        }
        setPlServerMetaEpoch((n) => n + 1);
      };
      window.addEventListener(PL_SERVER_COMPANY_META_UPDATED_EVENT, onMeta);
      return () => window.removeEventListener(PL_SERVER_COMPANY_META_UPDATED_EVENT, onMeta);
    }, [
      company?.id,
      (company as { plServerHostCompanyId?: string } | null)?.plServerHostCompanyId,
      (company as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId,
    ]);

    useEffect(() => {
      const cid = String(company?.id || "").trim();
      if (!cid || !companyUsesLocalStaffPermissions(company)) {
        if (sqlitePermissionStickyRef.current?.companyId !== cid) {
          sqlitePermissionStickyRef.current = null;
        }
        if (!cid) {
          setSqlitePermissionConfig(null);
          setSqliteLocalCompanyUsers(null);
        }
        return;
      }
      let cancelled = false;
      void (async () => {
        try {
          const { getLocalCompanyById } = await import("@/lib/localCompanyStore");
          const row = await getLocalCompanyById(cid, { includeDeleted: true });
          if (cancelled) return;
          setSqliteLocalCompanyUsers(
            (row as { localCompanyUsers?: unknown } | null)?.localCompanyUsers ?? null
          );
          const cfg = (row as { permissionConfig?: PermissionConfig } | null)?.permissionConfig;
          if (cfg && typeof cfg === "object") {
            const normalized = normalizePermissionConfig(cfg);
            sqlitePermissionStickyRef.current = { companyId: cid, config: normalized };
            setSqlitePermissionConfig(normalized);
            return;
          }
          // Row me config missing: sticky mat mitao — warna Manager editDays 7 default flash.
          if (sqlitePermissionStickyRef.current?.companyId === cid) {
            setSqlitePermissionConfig(sqlitePermissionStickyRef.current.config);
            return;
          }
          setSqlitePermissionConfig(null);
        } catch {
          if (!cancelled && sqlitePermissionStickyRef.current?.companyId === cid) {
            setSqlitePermissionConfig(sqlitePermissionStickyRef.current.config);
          } else if (!cancelled) {
            setSqlitePermissionConfig(null);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [
      company?.id,
      company?.storageOption,
      company?.plServerShared,
      localAuthEpoch,
      localCompanyRegistryEpoch,
      plServerMetaEpoch,
    ]);

    /** PL staff: company select pe ek baar host meta pull — SQLite me dateLimits land; epoch loop nahi. */
    useEffect(() => {
      const cid = String(company?.id || "").trim();
      if (!cid) return;
      const plSurface =
        company?.plServerShared === true ||
        isServerGateCompany(company) ||
        isPlServerThinStaffClient() ||
        Boolean(String((company as { plServerHostCompanyId?: string } | null)?.plServerHostCompanyId || "").trim());
      if (!plSurface) return;
      void (async () => {
        try {
          const { pullPlServerCompanyMetaFromHost } = await import("@/lib/plServerCompanyMetaSync");
          await pullPlServerCompanyMetaFromHost(cid);
        } catch {
          /* offline */
        }
      })();
    }, [company?.id, company?.plServerShared]);

    const permissions = useMemo(() => {
        const plStaffSurface = companyUsesDeviceOrPlPermissionConfig(company);
        const localStaffCompany = companyUsesLocalStaffPermissions(company);
        const localAuthToken =
          company?.id && localStaffCompany ? getLocalAuthToken(company.id) : null;
        const localAuthUser =
          company?.id && localAuthToken ? getLocalAuthUser(company.id) : null;

        // PL / local staff: SQLite (+ sticky) only — Firebase company.permissionConfig se flicker mat khao.
        const stickyCfg =
          company?.id && sqlitePermissionStickyRef.current?.companyId === company.id
            ? sqlitePermissionStickyRef.current.config
            : null;
        const configSource =
          localStaffCompany || plStaffSurface
            ? sqlitePermissionConfig
              ? "sqlite"
              : stickyCfg
                ? "sticky"
                : company?.permissionConfig
                  ? "company-row"
                  : "initial-default"
            : company?.permissionConfig
              ? "company-row"
              : sqlitePermissionConfig
                ? "sqlite"
                : stickyCfg
                  ? "sticky"
                  : "initial-default";
        const config = normalizePermissionConfig(
          localStaffCompany || plStaffSurface
            ? sqlitePermissionConfig || stickyCfg || company?.permissionConfig || initialPermissionConfig
            : company?.permissionConfig || sqlitePermissionConfig || stickyCfg || initialPermissionConfig
        );
        
        let role: UserRole = 'viewer'; 

        // Shared / PL unlock: prefer host SQLite `localCompanyUsers` role (Manage Sharing),
        // phir localAuth session — stale Manager session host Data Entry ko mat dabao.
        if (localAuthUser && company?.id) {
            if (localAuthUser.id === "local_admin_fallback") {
                role = "owner";
            } else if (plStaffSurface || company.isOwned === false) {
                const usersRaw =
                  sqliteLocalCompanyUsers ??
                  (company as { localCompanyUsers?: unknown }).localCompanyUsers;
                const localUsers = parseLocalCompanyUserRows(usersRaw);
                const sessionUn = String(localAuthUser.username || "").trim();
                const fromHostUsers =
                  findLocalCompanyUserRowForAppUser(
                    localUsers,
                    customUser?.uid || localAuthUser.id,
                    customUser?.email || (sessionUn.includes("@") ? sessionUn : null)
                  ) ||
                  localUsers.find(
                    (u) => u.username.trim().toLowerCase() === sessionUn.toLowerCase()
                  ) ||
                  (!sessionUn.includes("@")
                    ? localUsers.find((u) => {
                        const share = String(u.shareEmail || "")
                          .trim()
                          .toLowerCase();
                        return (
                          share.split("@")[0] === sessionUn.toLowerCase() ||
                          u.username.trim().toLowerCase() === sessionUn.toLowerCase()
                        );
                      })
                    : undefined);
                role = normalizeStaffRoleString(
                  fromHostUsers?.role
                    ? normalizeLocalCompanyAppRole(fromHostUsers.role)
                    : localAuthUser.role
                );
            } else if (customUser) {
                const shareUser = { uid: customUser.uid || "", email: customUser.email ?? null };
                if (resolveCompanyIsOwnedForUser(company, shareUser)) {
                    role = "owner";
                } else if (localAuthUser.role) {
                    role = normalizeStaffRoleString(localAuthUser.role);
                }
            } else if (localAuthUser.role) {
                role = normalizeStaffRoleString(localAuthUser.role);
            }
        } else if (customUser && company) {
            // SuperAdmin: treat as owner for selected company so they can use app like a normal user (plans, header buttons, etc.)
            if (customUser.role === 'SuperAdmin') {
                role = 'owner';
            } else {
            const shareUser = { uid: customUser.uid || "", email: customUser.email ?? null };
            if (resolveCompanyIsOwnedForUser(company, shareUser)) {
                role = 'owner';
            } else if (companyRolesAuthorityExcludesFirebase(company)) {
                // PL Server / local / Drive — assigned role from host SQLite users, never Firebase sharedWith.
                const localUsers = parseLocalCompanyUserRows(
                  (company as { localCompanyUsers?: unknown }).localCompanyUsers
                );
                const localRow = findLocalCompanyUserRowForAppUser(
                  localUsers,
                  customUser.uid,
                  customUser.email
                );
                if (localRow?.role) {
                  role = normalizeStaffRoleString(
                    normalizeLocalCompanyAppRole(localRow.role)
                  );
                }
            } else {
                const normalizedEmail = (customUser.email || "").toLowerCase().trim();
                const sharedUser = company.sharedWith?.find((u: any) => {
                    const sharedEmail = (u?.email || "").toLowerCase().trim();
                    const byUid = !!u?.uid && !!customUser.uid && String(u.uid) === String(customUser.uid);
                    const byEmail = !!sharedEmail && !!normalizedEmail && sharedEmail === normalizedEmail;
                    return byUid || byEmail;
                });
                if (sharedUser?.role) {
                    const normalizedRole = String(sharedUser.role)
                      .toLowerCase()
                      .trim()
                      .replace(/_/g, "-")
                      .replace(/\s+/g, "-");
                    if (["viewer", "data-entry", "accountant", "editor", "manager", "admin", "owner"].includes(normalizedRole)) {
                        role = normalizedRole as UserRole;
                    }
                } else if (isLocalStorageCompany(company) && normalizedEmail) {
                    // Cloud Drive share list removed — local users use sharedWith / localCompanyUsers only.
                }
            }
            }
        } else if (customUser && !company) {
            // Header "No Company": company-scoped role nahi milta — viewer reh kar `delete_records` false ho jata tha
            // aur sidebar / PermissionRouteGuard recycle bin chhupa dete. Bin me deleted companies tab bhi hoti hain.
            if (customUser.role === "SuperAdmin") {
                role = "owner";
            } else {
                const normalizedEmail = (customUser.email || "").toLowerCase().trim();
                const uid = (customUser.uid || "").trim();
                const ownsAnyInList = allCompanies.some((c) => {
                    if (c.isOwned === true) return true;
                    if (uid && String(c.ownerId || "").trim() === uid) return true;
                    if (normalizedEmail) {
                        const oe = String(c.ownerEmail || "").toLowerCase().trim();
                        if (oe && oe === normalizedEmail) return true;
                    }
                    return false;
                });
                // List empty: sab active companies delete ho chuki (ya load) — owner phir bhi apna recycle bin khol sake
                if (ownsAnyInList || (uid.length > 0 && allCompanies.length === 0)) {
                    role = "owner";
                }
            }
        }
        
        // Never transiently "viewer": reuse last server-confirmed role (per uid+company) until live data resolves.
        const sharedWithList = Array.isArray((company as { sharedWith?: unknown } | null)?.sharedWith)
          ? ((company as { sharedWith?: unknown[] }).sharedWith as unknown[])
          : [];
        const localUsersForEvidence = parseLocalCompanyUserRows(
          sqliteLocalCompanyUsers ?? (company as { localCompanyUsers?: unknown } | null)?.localCompanyUsers
        );
        const roleEvidenceLoaded =
          Boolean(localAuthUser) || sharedWithList.length > 0 || localUsersForEvidence.length > 0;
        const roleResolution = resolvePermissionRoleWithCache({
          uid: String(customUser?.uid || ""),
          companyId: String(company?.id || ""),
          derivedRole: role,
          evidenceLoaded: roleEvidenceLoaded,
        });
        role = roleResolution.role as UserRole;
        const permissionsResolved = roleResolution.resolved;
        const permissionsReverifyRequired = roleResolution.reverifyRequired;

        const dateLimits = config.dateLimits?.[role] || { entryDays: 0, editDays: 0, deleteDays: 0 };
        
        const can = (permissionName: Permission): boolean => roleCanPermission(role, permissionName, config);
        
        const canPerformBackdatedAction = ((action: 'entry' | 'edit' | 'delete', recordDate?: Date): boolean => {
            return evaluateBackdatePermission(action, recordDate, dateLimits, role).allowed;
        }) as CanPerformBackdatedFn;

        canPerformBackdatedAction.explain = (action, recordDate) => {
            const evaluation = evaluateBackdatePermission(action, recordDate, dateLimits, role);
            const verb = action === "entry" ? "create" : action;
            return formatBackdatePermissionDeniedMessage(evaluation, verb, role);
        };

        const canEditRecord = (isOwnRecord: boolean, voucher?: { isApproved?: boolean } | null): boolean => {
            if (role === 'owner') return true;
            if (voucher?.isApproved && !can('edit_approved_voucher')) return false;
            return can('edit_all_records') || (can('edit_own_records') && isOwnRecord);
        };

        const canDeleteVoucher = (voucher?: { isApproved?: boolean } | null): boolean => {
            if (!can('delete_records')) return false;
            if (voucher?.isApproved && !can('delete_approved_voucher')) return false;
            return true;
        };

        // Shared user: company.owner ka planId (advance file limit 2); owned: account-level best SKU
        const effectivePlanId = resolvePlanIdForActiveCompany(
          company,
          allCompanies,
          customUser?.uid,
          customUser?.email
        );
        const plan = getPlanFromPlans(livePlans, effectivePlanId);
        const roleFileLimits = config.fileAttachmentLimits?.[role] || { maxFileCount: 0, allowImage: false, allowPDF: false, allowDelete: false };

        // Plan entitlements (live `app_settings/plans` + cache); default basic tier me files band ho sakte hain
        let canAddFileImagePdf = plan.entitlements.canAddFileImagePdf === true;
        let planMaxFiles = Math.max(0, Math.min(10, Number(plan.entitlements.maxVoucherFileCount) || 0));

        /** Viewer ke alawa role jab file types allow karti ho — SQLite/local company par `planId` purana "basic" reh jata hai ya offline cache miss */
        const roleAllowsFiles =
          role !== "viewer" &&
          (roleFileLimits.maxFileCount > 0 || roleFileLimits.allowImage || roleFileLimits.allowPDF);

        // Static APK / local storage company: billing/advance Firestore tak sync na ho to bhi voucher attachments role ke hisaab se khulen
        if (
          company &&
          config.allowAttachments !== false &&
          roleAllowsFiles &&
          (!canAddFileImagePdf || planMaxFiles === 0) &&
          localLikeCompanyForAttachments(company)
        ) {
          canAddFileImagePdf = true;
          planMaxFiles = Math.max(
            planMaxFiles,
            Math.min(10, Math.max(1, Number(roleFileLimits.maxFileCount) || 3))
          );
        }

        let canAddAvatar = plan.entitlements.canAddAvatar === true;
        // Local company / APK: `app_settings/plans` sync na ho ya cache purana ho to `basic` bundle me `canAddAvatar: false` reh jata hai — party-staff avatar bhi voucher files jaisa role se chale
        if (
          company &&
          role !== "viewer" &&
          !canAddAvatar &&
          localLikeCompanyForAttachments(company)
        ) {
          canAddAvatar = true;
        }

        if (
          attachmentsAdUnlock &&
          role !== "viewer" &&
          config.allowAttachments !== false
        ) {
          canAddFileImagePdf = true;
          planMaxFiles = Math.max(
            planMaxFiles,
            Math.min(10, Math.max(1, Number(roleFileLimits.maxFileCount) || 3))
          );
        }
        const cappedMax = canAddFileImagePdf && planMaxFiles > 0
          ? Math.min(roleFileLimits.maxFileCount, planMaxFiles)
          : 0;
        const fileAttachmentLimits = canAddFileImagePdf && planMaxFiles > 0
          ? { ...roleFileLimits, maxFileCount: cappedMax }
          : { maxFileCount: 0, allowImage: false, allowPDF: false, allowDelete: false };
        const allowAttachments =
          (config.allowAttachments !== false) && canAddFileImagePdf && planMaxFiles > 0;

        const permSource = resolvePermissionConfigSource(company);
        const runtimeSig = [
          company?.id ?? "",
          role,
          configSource,
          String(dateLimits.editDays ?? ""),
          String(config.dateLimits?.manager?.editDays ?? ""),
          permSource.kind,
        ].join("|");
        if (plPermLogSigRef.current !== runtimeSig) {
          plPermLogSigRef.current = runtimeSig;
          logPlPerm("runtime", {
            companyId: company?.id ?? null,
            role,
            configSource,
            provider: permSource.kind,
            providerUrl: permSource.url,
            dateLimits: summarizePermissionDateLimits(config, role),
            managerEditDays: config.dateLimits?.manager?.editDays ?? null,
            usingInitialDefault: configSource === "initial-default",
          });
        }

        return { 
            can, 
            role, 
            dateLimits, 
            canPerformBackdatedAction, 
            canEditRecord,
            canDeleteVoucher,
            fileAttachmentLimits,
            allowAttachments,
            canAddAvatar,
            canAddFileImagePdf,
            permissionsResolved,
            permissionsReverifyRequired,
            permissionConfig: config,
            permissionConfigSource: permSource,
            permissionConfigSourceKey: configSource,
        };

    }, [customUser, company, allCompanies, livePlans, localAuthEpoch, localCompanyRegistryEpoch, plServerMetaEpoch, sqlitePermissionConfig, sqliteLocalCompanyUsers, attachmentsAdUnlock, onlineEpoch]);

    return permissions;
};

function normalizeStaffRoleString(raw: string | undefined): UserRole {
    return permissionRoleKey(raw) || "viewer";
}

type RecycleBinCompanyOwnerPick = { ownerId?: string; ownerEmail?: string };

/**
 * Recycle bin me deleted **local** company: header me jo company select hai uske `usePermissions` se alag —
 * is company id ke local unlock session (ya Firebase owner) se role.
 */
export function getLocalSessionRoleForRecycleBinCompany(
    companyId: string,
    row: RecycleBinCompanyOwnerPick | undefined,
    firebaseUid: string | undefined,
    firebaseEmail: string | null | undefined
): UserRole {
    const cid = String(companyId || "").trim();
    if (!cid) return "viewer";

    if (getLocalAuthToken(cid)) {
        const u = getLocalAuthUser(cid);
        if (u?.id === "local_admin_fallback") return "owner";
        return normalizeStaffRoleString(u?.role);
    }

    if (row && firebaseUid) {
        const ue = String(firebaseEmail || "").toLowerCase().trim();
        const oid = String(row.ownerId || "").trim();
        const oe = String(row.ownerEmail || "").toLowerCase().trim();
        if (oid && oid === firebaseUid) return "owner";
        if (oe && ue && oe === ue) return "owner";
    }
    return "viewer";
}

/** Local company recycle bin row: `permanently_delete_records` / `delete_records` header company se alag evaluate. */
export function canForRecycleBinLocalCompany(
    companyId: string,
    row: RecycleBinCompanyOwnerPick | undefined,
    firebaseUid: string | undefined,
    firebaseEmail: string | null | undefined,
    permission: Permission,
    permissionConfig?: PermissionConfig | null
): boolean {
    const role = getLocalSessionRoleForRecycleBinCompany(companyId, row, firebaseUid, firebaseEmail);
    return roleCanPermission(role, permission, permissionConfig || initialPermissionConfig);
}

export default usePermissions;
