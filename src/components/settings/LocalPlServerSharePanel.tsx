"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, query, where } from "firebase/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CloudSyncHelpPopover } from "@/components/company/CloudSyncHelpPopover";
import { Crown, Eye, EyeOff, Loader2, Pencil, PlusCircle, RotateCcw, Trash2 } from "lucide-react";
import {
  inviteUserToPlServerShare,
  listPlServerShareUserRowsFromCompany,
  guessGmailCandidatesForLoginUsername,
  lookupFirestoreUserProfileByHint,
  backfillLocalCompanyUserShareMeta,
  type PlServerShareUserRow,
} from "@/lib/plServerShareInviteFlow";
import {
  getElectronLocalServerApi,
  resolveLocalAppServerSharingPort,
  type LocalAppServerStatus,
} from "@/lib/electronLocalServer";
import { isLocalCompanyHostShareable, listShareableLocalCompaniesForHost } from "@/lib/listShareableLocalCompaniesForHost";
import { filterShareableCompaniesForHostConfig } from "@/lib/plServerHostSharedCompanyIds";
import type { Company } from "@/hooks/useCompany";
import { useCompany } from "@/hooks/useCompany";
import { LOCAL_COMPANY_APP_ROLES, localCompanyAppRoleLabel, normalizeLocalCompanyAppRole } from "@/lib/localCompanyAppRoles";
import { cn } from "@/lib/utils";
import { clientRandomUUID } from "@/lib/clientRandomUUID";
import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import {
  parseLocalCompanyUserRows,
  removeDriveShareUserFromLocalCompanyUsers,
  upsertUserInList,
  withLocalCompanyUsersWriteLock,
  type LocalCompanyUserRecord,
} from "@/lib/localCompanyUsers";
import { assertCanAddPlServerShareUser } from "@/lib/localShareRouteGuards";
import { readCloudSyncDriveShareUsers, shareUsersToEmailList } from "@/lib/localCloudSync/companyConfig";
import { revokeDriveFolderShare } from "@/lib/localCloudSync/driveCloudSyncClient";
import { bumpLocalCompanyRegistry } from "@/lib/applyStripePlanToLocalCompany";
import { flushPendingBrowserDbSave } from "@/lib/localSqlite";
import {
  COMPANY_CLIENT_DATA_DELETE_DELAYS,
  createCompanyClientDataDeleteCommand,
  appendLocalCompanyClientDataDeleteCommand,
  type CompanyClientDataDeleteDelay,
} from "@/lib/companyClientDataDeleteCommands";

const normalizeEmail = (email?: string) => String(email || "").trim().toLowerCase();

function avatarUrl(email: string) {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(email || "user")}`;
}

function getAvatarUrl(seed: string, photoURL?: string) {
  if (photoURL?.trim()) return photoURL.trim();
  return avatarUrl(seed);
}

type AppUserProfile = {
  id: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  online?: boolean;
  lastSeen?: { toDate?: () => Date };
};

function isUserOnline(userInfo?: AppUserProfile | null): boolean {
  if (!userInfo) return false;
  if (userInfo.online === true) return true;
  if (!userInfo.lastSeen?.toDate) return false;
  return Date.now() - userInfo.lastSeen.toDate().getTime() < 90_000;
}

function mergeAppUserProfiles(prev: AppUserProfile[], incoming: AppUserProfile[]): AppUserProfile[] {
  const map = new Map(prev.map((x) => [x.id, x]));
  for (const u of incoming) {
    const prevRow = map.get(u.id);
    const photoURL = String(u.photoURL || prevRow?.photoURL || "").trim() || undefined;
    map.set(u.id, {
      ...prevRow,
      ...u,
      photoURL,
      displayName: u.displayName || prevRow?.displayName,
      email: u.email || prevRow?.email,
    });
  }
  return Array.from(map.values());
}

function rememberProfilesInCache(
  cache: Map<string, AppUserProfile>,
  profiles: AppUserProfile[]
): void {
  for (const p of profiles) {
    const em = normalizeEmail(p.email);
    if (!em.includes("@")) continue;
    const prev = cache.get(em);
    const photoURL = String(p.photoURL || prev?.photoURL || "").trim() || undefined;
    cache.set(em, {
      ...prev,
      ...p,
      photoURL,
      displayName: p.displayName || prev?.displayName,
      email: p.email || prev?.email || em,
    });
  }
}

function resolveAppUserForRow(
  row: PlServerShareUserRow,
  appUsers: AppUserProfile[],
  profileCache?: Map<string, AppUserProfile>
): AppUserProfile | undefined {
  for (const raw of [row.email, row.shareEmail]) {
    const em = normalizeEmail(raw);
    if (!em.includes("@")) continue;
    const cached = profileCache?.get(em);
    if (cached) return cached;
    const hit = appUsers.find((u) => normalizeEmail(u.email) === em);
    if (hit) return hit;
  }
  const uid = String(row.uid || "").trim();
  if (uid) {
    const hit = appUsers.find(
      (u) => u.id === uid || String((u as { uid?: string }).uid || "").trim() === uid
    );
    if (hit) return hit;
  }
  const login = String(row.loginUsername || "").trim().toLowerCase();
  if (login) {
    for (const em of guessGmailCandidatesForLoginUsername(login)) {
      const cached = profileCache?.get(normalizeEmail(em));
      if (cached) return cached;
    }
    const hit = appUsers.find((u) => {
      const em = normalizeEmail(u.email);
      if (!em.includes("@")) return false;
      return em === login || em.split("@")[0] === login;
    });
    if (hit) return hit;
  }
  const name = row.name.trim().toLowerCase();
  if (name) {
    return appUsers.find((u) => u.displayName?.trim().toLowerCase() === name);
  }
  return undefined;
}

function chunkEmails(values: string[], size: number): string[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, i) =>
    values.slice(i * size, i * size + size)
  );
}

function UserAvatarWithPresence({
  seed,
  photoURL,
  isOnline,
  fallbackInitials,
}: {
  seed: string;
  photoURL?: string;
  isOnline: boolean;
  fallbackInitials: string;
}) {
  const seedRef = useRef(seed);
  const stablePhotoRef = useRef<string | undefined>(undefined);
  if (seedRef.current !== seed) {
    seedRef.current = seed;
    stablePhotoRef.current = undefined;
  }
  if (photoURL?.trim()) {
    stablePhotoRef.current = photoURL.trim();
  }
  const avatarSrc = getAvatarUrl(seed, stablePhotoRef.current);

  return (
    <div
      className={cn(
        "relative shrink-0 rounded-full p-[2px] transition-all duration-500",
        isOnline ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]" : "bg-black"
      )}
    >
      <Avatar className="h-9 w-9 border-2 border-background">
        <AvatarImage src={avatarSrc} className="object-cover" />
        <AvatarFallback className="bg-muted text-xs font-bold">{fallbackInitials}</AvatarFallback>
      </Avatar>
    </div>
  );
}

function initials(nameOrEmail: string) {
  const s = (nameOrEmail || "").trim();
  if (!s) return "U";
  const parts = s.includes("@") ? s.split("@")[0].split(/[.\s_-]+/) : s.split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "U";
}

type Props = {
  companyId?: string | null;
  companyName?: string;
  allCompaniesRegistry: Company[];
  serverStatus?: LocalAppServerStatus | null;
  sharedLocalCompanyIds?: string[] | null;
  onCompanySelect?: (companyId: string) => void;
  variant?: "settings" | "manageShare";
  disabled?: boolean;
  onUsersChanged?: () => void;
};

type ShareRouteTab = "server" | "drive";

export function LocalPlServerSharePanel({
  companyId,
  companyName,
  allCompaniesRegistry,
  serverStatus,
  sharedLocalCompanyIds,
  onCompanySelect,
  variant = "settings",
  disabled,
  onUsersChanged,
}: Props) {
  const { user, customUser } = useAuth();
  const { toast } = useToast();
  const { localCompanyRegistryEpoch, companyId: activeCompanyId, company: activeCompany } = useCompany();
  const effectiveCompanyId = String(companyId || activeCompanyId || "").trim();
  const effectiveCompanyName =
    companyName ||
    activeCompany?.name ||
    allCompaniesRegistry.find((c) => c.id === effectiveCompanyId)?.name ||
    effectiveCompanyId;
  const [userRows, setUserRows] = useState<PlServerShareUserRow[]>([]);
  const [shareableCompanies, setShareableCompanies] = useState<Company[]>([]);
  const [hostShareable, setHostShareable] = useState(false);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [appUsers, setAppUsers] = useState<AppUserProfile[]>([]);

  const [shareEmail, setShareEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("manager");
  const [showPw, setShowPw] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTokenRow, setEditTokenRow] = useState<PlServerShareUserRow | null>(null);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editLoginUsername, setEditLoginUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState("manager");
  const [editShowPw, setEditShowPw] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [removeUserRow, setRemoveUserRow] = useState<PlServerShareUserRow | null>(null);
  const [removeUserDeleteData, setRemoveUserDeleteData] = useState(false);
  const [removeUserDeleteDelay, setRemoveUserDeleteDelay] = useState<CompanyClientDataDeleteDelay>("now");
  const [roleBusyTokenId, setRoleBusyTokenId] = useState<string | null>(null);
  const [routeConflictOpen, setRouteConflictOpen] = useState(false);
  const [routeConflictBusy, setRouteConflictBusy] = useState(false);
  const [routeTab, setRouteTab] = useState<ShareRouteTab>("server");
  const hostShareableCompanyIdRef = useRef<string | null>(null);
  const profileByEmailRef = useRef(new Map<string, AppUserProfile>());
  const backfilledShareMetaRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    void listShareableLocalCompaniesForHost(allCompaniesRegistry).then((rows) => {
      if (!cancelled) setShareableCompanies(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [allCompaniesRegistry, localCompanyRegistryEpoch]);

  const companySelectOptions = useMemo(
    () =>
      filterShareableCompaniesForHostConfig(shareableCompanies, sharedLocalCompanyIds).map((c) => ({
        id: c.id,
        name: c.name || c.id,
      })),
    [shareableCompanies, sharedLocalCompanyIds]
  );

  const activeLocalCompanyForRoutes = useMemo(
    () =>
      shareableCompanies.find((c) => c.id === effectiveCompanyId) ||
      allCompaniesRegistry.find((c) => c.id === effectiveCompanyId) ||
      activeCompany ||
      null,
    [shareableCompanies, allCompaniesRegistry, activeCompany, effectiveCompanyId]
  );

  const driveRouteRows = useMemo(() => {
    const row = activeLocalCompanyForRoutes as Record<string, unknown> | null;
    const ownerEmail = normalizeEmail(String(row?.ownerEmail || user?.email || ""));
    const out: Array<{ email: string; name: string; role: string; route: string }> = [];
    for (const u of readCloudSyncDriveShareUsers(row)) {
      const email = normalizeEmail(u.email);
      if (!email.includes("@") || email === ownerEmail) continue;
      const profile = appUsers.find((p) => normalizeEmail(p.email) === email) || profileByEmailRef.current.get(email);
      out.push({
        email,
        name: profile?.displayName || email.split("@")[0] || email,
        role: localCompanyAppRoleLabel(normalizeLocalCompanyAppRole(u.appRole)),
        route: "Google Drive",
      });
    }
    return out;
  }, [activeLocalCompanyForRoutes, appUsers, user?.displayName, user?.email]);

  const driveRouteEmailSet = useMemo(
    () => new Set(driveRouteRows.map((row) => normalizeEmail(row.email)).filter(Boolean)),
    [driveRouteRows]
  );

  useEffect(() => {
    let cancelled = false;
    const companyChanged = hostShareableCompanyIdRef.current !== effectiveCompanyId;
    if (companyChanged) {
      hostShareableCompanyIdRef.current = effectiveCompanyId;
      setCompaniesLoading(true);
    }
    const registryRow =
      activeCompany?.id === effectiveCompanyId
        ? activeCompany
        : allCompaniesRegistry.find((c) => c.id === effectiveCompanyId) ?? null;
    void isLocalCompanyHostShareable(effectiveCompanyId, allCompaniesRegistry, registryRow).then((ok) => {
      if (!cancelled) {
        setHostShareable(ok);
        setCompaniesLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveCompanyId, allCompaniesRegistry, localCompanyRegistryEpoch, activeCompany]);

  const scopedCompanyIds = useMemo(() => {
    if (!effectiveCompanyId || !hostShareable) return [];
    return [effectiveCompanyId];
  }, [effectiveCompanyId, hostShareable]);

  const ownerEmail = user?.email || "";

  const refreshUserRows = useCallback(async (options?: { silent?: boolean }) => {
    if (!effectiveCompanyId && scopedCompanyIds.length === 0) {
      setUserRows([]);
      setLoading(false);
      return;
    }
    if (!options?.silent) setLoading(true);
    try {
      const ids = scopedCompanyIds.length > 0 ? scopedCompanyIds : [effectiveCompanyId].filter(Boolean);
      const rows = (await Promise.all(ids.map((id) => listPlServerShareUserRowsFromCompany(id, ownerEmail)))).flat();
      const merged = new Map<string, PlServerShareUserRow>();
      for (const row of rows) {
        const key = normalizeEmail(row.shareEmail || row.email) || row.loginUsername || row.tokenId;
        const prev = merged.get(key);
        // Later row wins role (duplicate local users) — pehli stale Manager-miss mat rakho.
        merged.set(
          key,
          prev
            ? {
                ...row,
                role: row.role || prev.role,
                allowedCompanyIds: [
                  ...new Set([...(prev.allowedCompanyIds || []), ...(row.allowedCompanyIds || [])]),
                ],
              }
            : row
        );
      }
      const nextRows = [...merged.values()];
      setUserRows(nextRows);
      // F5 / panel open: IndexedDB se kya aaya — filter label `PL-ROLE`
      if (!options?.silent || nextRows.length > 0) {
        try {
          const { plRoleLog } = await import("@/lib/plRoleChangeLog");
          plRoleLog("panel_boot_read", {
            companyId: effectiveCompanyId,
            silent: Boolean(options?.silent),
            users: nextRows.map((r) => ({
              tokenId: String(r.tokenId || "").slice(0, 40),
              role: r.role,
              login: r.loginUsername || r.shareEmail || r.email || null,
            })),
          });
        } catch {
          /* ignore */
        }
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveCompanyId, ownerEmail, scopedCompanyIds]);

  useEffect(() => {
    void refreshUserRows({ silent: true });
  }, [refreshUserRows, localCompanyRegistryEpoch]);

  const displayedUserRows = useMemo(
    () =>
      userRows.filter((row) => {
        const email = normalizeEmail(row.shareEmail || row.email);
        return !email || !driveRouteEmailSet.has(email);
      }),
    [driveRouteEmailSet, userRows]
  );

  useEffect(() => {
    const emailSet = new Set<string>();
    if (ownerEmail) emailSet.add(normalizeEmail(ownerEmail));
    for (const row of displayedUserRows) {
      for (const raw of [row.email, row.shareEmail, row.loginUsername]) {
        for (const em of guessGmailCandidatesForLoginUsername(String(raw || ""))) {
          emailSet.add(normalizeEmail(em));
        }
      }
    }
    const emails = [...emailSet];
    const uids = [
      ...new Set(displayedUserRows.map((r) => String(r.uid || "").trim()).filter(Boolean)),
    ];

    if (!emails.length && !uids.length) {
      setAppUsers([]);
      return;
    }

    const unsubs: Array<() => void> = [];
    const mergeUsers = (incoming: AppUserProfile[]) => {
      rememberProfilesInCache(profileByEmailRef.current, incoming);
      setAppUsers((prev) => mergeAppUserProfiles(prev, incoming));
    };

    chunkEmails(emails, 10).forEach((batch) => {
      const qy = query(collection(firestore, "users"), where("email", "in", batch));
      unsubs.push(
        onSnapshot(qy, (snap) => {
          mergeUsers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as AppUserProfile[]);
        })
      );
    });

    uids.forEach((uid) => {
      unsubs.push(
        onSnapshot(doc(firestore, "users", uid), (snap) => {
          if (snap.exists()) {
            mergeUsers([{ id: snap.id, ...(snap.data() as object) } as AppUserProfile]);
          }
        })
      );
    });

    return () => unsubs.forEach((u) => u());
  }, [ownerEmail, displayedUserRows]);

  const displayedUserIdentityKey = useMemo(
    () =>
      displayedUserRows
        .map((row) => `${row.tokenId}\0${normalizeEmail(row.shareEmail || row.email)}\0${row.loginUsername || ""}`)
        .join("|"),
    [displayedUserRows]
  );
  const displayedUserRowsRef = useRef(displayedUserRows);
  displayedUserRowsRef.current = displayedUserRows;

  useEffect(() => {
    if (!effectiveCompanyId || !displayedUserIdentityKey) return;
    let cancelled = false;
    void (async () => {
      for (const row of displayedUserRowsRef.current) {
        if (cancelled) return;
        const backfillKey = `${effectiveCompanyId}:${row.tokenId}`;
        const inferredShareEmail = normalizeEmail(row.shareEmail || row.email);
        if (inferredShareEmail.includes("@") && !row.shareEmail && !backfilledShareMetaRef.current.has(`${backfillKey}:email`)) {
          backfilledShareMetaRef.current.add(`${backfillKey}:email`);
          const localUserId = row.tokenId.replace(/^lcu:/, "");
          await backfillLocalCompanyUserShareMeta(effectiveCompanyId, localUserId, {
            shareEmail: inferredShareEmail,
            uid: row.uid ?? null,
          });
          if (cancelled) return;
          onUsersChanged?.();
        }
        const knownEmail = normalizeEmail(row.email || row.shareEmail);
        const cached =
          knownEmail.includes("@") ? profileByEmailRef.current.get(knownEmail) : undefined;
        if (cached?.photoURL && knownEmail.includes("@") && row.uid) continue;
        if (backfilledShareMetaRef.current.has(backfillKey) && cached?.photoURL) continue;

        const profile = await lookupFirestoreUserProfileByHint({
          email: row.email || row.shareEmail,
          loginUsername: row.loginUsername,
        });
        if (cancelled || !profile?.id) continue;

        const mergedProfile = {
          ...profile,
          lastSeen: profile.lastSeen as AppUserProfile["lastSeen"],
        } as AppUserProfile;
        rememberProfilesInCache(profileByEmailRef.current, [mergedProfile]);
        setAppUsers((prev) => mergeAppUserProfiles(prev, [mergedProfile]));

        const shareEmail = normalizeEmail(profile.email);
        if (shareEmail.includes("@") && !backfilledShareMetaRef.current.has(backfillKey)) {
          backfilledShareMetaRef.current.add(backfillKey);
          const localUserId = row.tokenId.replace(/^lcu:/, "");
          await backfillLocalCompanyUserShareMeta(effectiveCompanyId, localUserId, {
            shareEmail,
            uid: profile.id,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [displayedUserIdentityKey, effectiveCompanyId, onUsersChanged]);

  useEffect(() => {
    if (!addOpen) return;
    setShareEmail("");
    setDisplayName("");
    setLoginUsername("");
    setPassword("");
    setRole("manager");
    setShowPw(false);
  }, [addOpen]);

  const resolveCompanyNames = (ids: string[]) =>
    ids
      .map(
        (id) =>
          (id === effectiveCompanyId ? effectiveCompanyName : null) ||
          allCompaniesRegistry.find((c) => c.id === id)?.name ||
          id
      )
      .join(", ");

  const selectedCompanyIds = scopedCompanyIds;

  const handleShare = async (options?: { skipRouteGuard?: boolean }) => {
    const email = shareEmail.trim().toLowerCase();
    if (!email.includes("@")) {
      toast({ variant: "destructive", title: "Valid Gmail required" });
      return;
    }
    if (!loginUsername.trim() || !password.trim()) {
      toast({ variant: "destructive", title: "Login username and password required" });
      return;
    }
    if (!selectedCompanyIds.length) {
      toast({
        variant: "destructive",
        title: "Select a local company",
        description: "Header se company select karein. User manually IP:port add karke login karega.",
      });
      return;
    }
    if (!user?.uid) {
      toast({ variant: "destructive", title: "Sign in required" });
      return;
    }

    setBusy(true);
    try {
      if (options?.skipRouteGuard !== true) {
        for (const companyId of selectedCompanyIds) {
          const doc = await getLocalCompanyById(companyId, { includeDeleted: true });
          assertCanAddPlServerShareUser(doc as Record<string, unknown> | null, email);
        }
      }
      let serverUrls = serverStatus?.urls ?? [];
      let serverPort = resolveLocalAppServerSharingPort(serverStatus) ?? undefined;
      let publicHost = "";
      const api = getElectronLocalServerApi();
      if (api?.getStatus) {
        const [liveStatus, liveConfig] = await Promise.all([
          api.getStatus().catch(() => null),
          api.getConfig?.().catch(() => null),
        ]);
        if (liveStatus?.urls?.length) serverUrls = liveStatus.urls;
        serverPort = resolveLocalAppServerSharingPort(liveStatus) ?? serverPort;
        publicHost = String(liveConfig?.publicHost || "").trim();
      }

      const result = await inviteUserToPlServerShare({
        recipientEmail: email,
        displayName: displayName.trim() || email,
        loginUsername: loginUsername.trim(),
        password: password.trim(),
        role,
        allowedCompanyIds: selectedCompanyIds,
        senderUserId: user.uid,
        senderEmail: user.email,
        senderName: user.displayName,
        serverUrls,
        publicHost,
        serverPort,
        gateLabel: effectiveCompanyName ? `${effectiveCompanyName} server` : "Pocket Ledger server",
        companyNames: resolveCompanyNames(selectedCompanyIds),
      });
      if (result.ok === false) {
        toast({ variant: "destructive", title: "Share failed", description: result.reason });
        return;
      }
      const doc = await getLocalCompanyById(effectiveCompanyId, { includeDeleted: true });
      if (doc) {
        const prev = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown }).localCompanyUsers);
        const next = upsertUserInList(prev, {
          username: loginUsername.trim(),
          displayName: displayName.trim() || email,
          role,
          password: password.trim(),
          shareEmail: email,
        });
        await upsertLocalCompany({
          ...(doc as LocalCompanyDoc),
          id: effectiveCompanyId,
          localCompanyUsers: next,
          updatedAt: Date.now(),
        });
        await flushPendingBrowserDbSave();
        bumpLocalCompanyRegistry();
        void import("@/lib/plServerCompanyMetaSync").then(({ notifyPlServerHostCompanyMetaSaved }) =>
          notifyPlServerHostCompanyMetaSaved(effectiveCompanyId)
        );
      }
      toast({
        title: "User saved",
        description: "Ask the user to add this server IP:port in Gate, then login with the username/password.",
      });
      setAddOpen(false);
      await refreshUserRows();
      onUsersChanged?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("another sharing method") || msg.includes("Google Drive")) {
        setRouteConflictOpen(true);
      } else {
        toast({ variant: "destructive", title: "Share failed", description: msg });
      }
    } finally {
      setBusy(false);
    }
  };

  const changeMethodToPlServer = async () => {
    const email = normalizeEmail(shareEmail);
    if (!email) return;
    setRouteConflictBusy(true);
    try {
      for (const companyId of selectedCompanyIds) {
        const doc = await getLocalCompanyById(companyId, { includeDeleted: true });
        if (!doc) continue;
        try {
          await revokeDriveFolderShare({
            companyId,
            companyName: typeof doc.name === "string" ? doc.name : undefined,
            email,
          });
        } catch {
          /* local list conversion still proceeds */
        }
        const nextDriveUsers = readCloudSyncDriveShareUsers(doc as Record<string, unknown>).filter(
          (u) => normalizeEmail(u.email) !== email
        );
        let localCompanyUsers = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown }).localCompanyUsers);
        localCompanyUsers = removeDriveShareUserFromLocalCompanyUsers(localCompanyUsers, email);
        await upsertLocalCompany({
          ...(doc as LocalCompanyDoc),
          id: companyId,
          cloudSyncDriveShareUsers: nextDriveUsers,
          cloudSyncSharedEmails: shareUsersToEmailList(nextDriveUsers),
          localCompanyUsers,
          updatedAt: Date.now(),
        });
      }
      setRouteConflictOpen(false);
      await handleShare({ skipRouteGuard: true });
    } finally {
      setRouteConflictBusy(false);
    }
  };

  const openRemoveUserDialog = (row: PlServerShareUserRow) => {
    setRemoveUserRow(row);
    setRemoveUserDeleteData(false);
    setRemoveUserDeleteDelay("now");
  };

  const closeRemoveUserDialog = () => {
    if (busyEmail) return;
    setRemoveUserRow(null);
    setRemoveUserDeleteData(false);
    setRemoveUserDeleteDelay("now");
  };

  const revokeUser = async (
    row: PlServerShareUserRow,
    options?: { deleteClientData?: boolean; deleteDelay?: CompanyClientDataDeleteDelay }
  ) => {
    if (!effectiveCompanyId) return;
    setBusyEmail(row.email || row.name);
    try {
      const doc = await getLocalCompanyById(effectiveCompanyId, { includeDeleted: true });
      if (!doc) return;
      const userId = row.tokenId.startsWith("lcu:") ? row.tokenId.slice(4) : "";
      const prev = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown }).localCompanyUsers);
      const next = userId
        ? prev.filter((u) => u.id !== userId)
        : prev.filter((u) => {
            const un = u.username.trim().toLowerCase();
            const email = row.email.trim().toLowerCase();
            if (email && un === email) return false;
            return u.displayName.trim().toLowerCase() !== row.name.trim().toLowerCase();
          });
      if (options?.deleteClientData) {
        const targetEmail = normalizeEmail(row.shareEmail || row.email);
        if (targetEmail) {
          await appendLocalCompanyClientDataDeleteCommand(
            effectiveCompanyId,
            createCompanyClientDataDeleteCommand({
              companyId: effectiveCompanyId,
              companyName: effectiveCompanyName,
              targetEmail,
              requestedByEmail: user?.email ?? null,
              delay: options.deleteDelay ?? "now",
              source: "pl_server",
            })
          );
        } else {
          toast({
            variant: "destructive",
            title: "Delete command skipped",
            description: "This shared user has no Gmail/email binding.",
          });
        }
      }
      await upsertLocalCompany({
        ...(doc as LocalCompanyDoc),
        id: effectiveCompanyId,
        localCompanyUsers: next,
        updatedAt: Date.now(),
      });
      await flushPendingBrowserDbSave();
      bumpLocalCompanyRegistry();
      void import("@/lib/plServerCompanyMetaSync").then(({ notifyPlServerHostCompanyMetaSaved }) =>
        notifyPlServerHostCompanyMetaSaved(effectiveCompanyId)
      );
      toast({ title: "User removed", description: row.email || row.name });
      setRemoveUserRow(null);
      setRemoveUserDeleteData(false);
      setRemoveUserDeleteDelay("now");
      await refreshUserRows();
      onUsersChanged?.();
    } finally {
      setBusyEmail(null);
    }
  };

  const confirmRemoveUser = async () => {
    if (!removeUserRow) return;
    await revokeUser(removeUserRow, {
      deleteClientData: removeUserDeleteData,
      deleteDelay: removeUserDeleteDelay,
    });
  };

  const refreshUserAccess = async (row: PlServerShareUserRow) => {
    setBusyEmail(row.email || row.name);
    try {
      toast({
        title: "Access refreshed",
        description: "Remote clients will ask password after their next server sync if login is required.",
      });
      await refreshUserRows();
      onUsersChanged?.();
    } finally {
      setBusyEmail(null);
    }
  };

  const findLocalUserForShareRow = (
    users: LocalCompanyUserRecord[],
    row: PlServerShareUserRow,
    fallbackName?: string
  ): LocalCompanyUserRecord | null => {
    const tokenUserId = String(row.tokenId || "").replace(/^lcu:/, "").trim();
    const email = normalizeEmail(row.email);
    const shareEmail = normalizeEmail(row.shareEmail || "");
    const localPart = email.includes("@") ? email.split("@")[0]!.trim().toLowerCase() : "";
    const label = String(fallbackName || row.name || "").trim().toLowerCase();
    return (
      (tokenUserId ? users.find((u) => u.id === tokenUserId) : undefined) ||
      users.find((u) => normalizeEmail(u.username) === email) ||
      (shareEmail.includes("@")
        ? users.find((u) => normalizeEmail(u.shareEmail || "") === shareEmail)
        : undefined) ||
      (localPart ? users.find((u) => u.username.trim().toLowerCase() === localPart) : undefined) ||
      (label ? users.find((u) => u.displayName.trim().toLowerCase() === label) : undefined) ||
      null
    );
  };

  const matchLocalUsersForShareRow = (
    users: LocalCompanyUserRecord[],
    row: PlServerShareUserRow,
    fallbackName?: string
  ): LocalCompanyUserRecord[] => {
    const primary = findLocalUserForShareRow(users, row, fallbackName);
    if (!primary) return [];
    const email = normalizeEmail(row.email || row.shareEmail || primary.shareEmail || "");
    const localPart = email.includes("@") ? email.split("@")[0]!.trim().toLowerCase() : "";
    const ids = new Set<string>([primary.id]);
    const out = [primary];
    for (const u of users) {
      if (ids.has(u.id)) continue;
      const un = u.username.trim().toLowerCase();
      const share = normalizeEmail(u.shareEmail || "");
      const same =
        (email.includes("@") && (normalizeEmail(un) === email || share === email)) ||
        (localPart && (un === localPart || (share.includes("@") && share.split("@")[0] === localPart)));
      if (!same) continue;
      ids.add(u.id);
      out.push(u);
    }
    return out;
  };

  const openEditUser = async (row: PlServerShareUserRow, fallbackName?: string) => {
    if (!effectiveCompanyId) return;
    setBusyEmail(row.email);
    try {
      const doc = await getLocalCompanyById(effectiveCompanyId, { includeDeleted: true });
      const users = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown } | null)?.localCompanyUsers);
      const localUser = findLocalUserForShareRow(users, row, fallbackName);
      const email = normalizeEmail(row.email);
      setEditTokenRow(row);
      setEditUserId(localUser?.id ?? null);
      setEditDisplayName(localUser?.displayName || fallbackName || row.name || email);
      setEditLoginUsername(localUser?.username || (email.includes("@") ? email.split("@")[0] || email : email));
      setEditPassword("");
      setEditRole(localUser?.role || row.role || "manager");
      setEditShowPw(false);
      setEditOpen(true);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not load user",
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusyEmail(null);
    }
  };

  const saveEditedUser = async () => {
    if (!effectiveCompanyId || !editTokenRow) return;
    const username = editLoginUsername.trim();
    const name = editDisplayName.trim() || editTokenRow.email;
    const passwordValue = editPassword.trim();
    if (!username) {
      toast({ variant: "destructive", title: "Login username required" });
      return;
    }
    setEditBusy(true);
    try {
      const doc = await getLocalCompanyById(effectiveCompanyId, { includeDeleted: true });
      if (!doc) throw new Error("Local company not found");
      const prev = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown }).localCompanyUsers);
      const existingIdx = editUserId
        ? prev.findIndex((u) => u.id === editUserId)
        : prev.findIndex((u) => u.username.trim().toLowerCase() === username.toLowerCase());
      const duplicateIdx = prev.findIndex(
        (u, idx) => idx !== existingIdx && u.username.trim().toLowerCase() === username.toLowerCase()
      );
      if (duplicateIdx >= 0) {
        toast({ variant: "destructive", title: "Username already exists" });
        return;
      }
      if (existingIdx < 0 && !passwordValue) {
        toast({ variant: "destructive", title: "Password required for new login user" });
        return;
      }
      const previous = existingIdx >= 0 ? prev[existingIdx] : null;
      const nextRow: LocalCompanyUserRecord = {
        id: previous?.id || `lcu_${clientRandomUUID()}`,
        username,
        displayName: name,
        role: editRole.trim().toLowerCase() || "manager",
        password: passwordValue || previous?.password || "",
        uid: previous?.uid ?? null,
        shareEmail: normalizeEmail(editTokenRow.shareEmail || editTokenRow.email) || previous?.shareEmail || null,
      };
      const next = existingIdx >= 0 ? [...prev] : [...prev, nextRow];
      if (existingIdx >= 0) next[existingIdx] = nextRow;
      await upsertLocalCompany({
        ...(doc as LocalCompanyDoc),
        id: effectiveCompanyId,
        localCompanyUsers: next,
        updatedAt: Date.now(),
      });
      await flushPendingBrowserDbSave();
      bumpLocalCompanyRegistry();
      void import("@/lib/plServerCompanyMetaSync").then(({ notifyPlServerHostCompanyMetaSaved }) =>
        notifyPlServerHostCompanyMetaSaved(effectiveCompanyId)
      );
      toast({ title: "User updated", description: `${name} login password saved.` });
      setEditOpen(false);
      setEditTokenRow(null);
      await refreshUserRows();
      onUsersChanged?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof Error ? e.message : "Could not save password.",
      });
    } finally {
      setEditBusy(false);
    }
  };

  const updateUserRole = async (row: PlServerShareUserRow, nextRoleRaw: string, fallbackName?: string) => {
    if (!effectiveCompanyId) return;
    const nextRole = normalizeLocalCompanyAppRole(nextRoleRaw);
    const primaryId = String(row.tokenId || "").replace(/^lcu:/, "").trim();
    const { plRoleLog, plRoleUsersSummary } = await import("@/lib/plRoleChangeLog");
    plRoleLog("select", {
      companyId: effectiveCompanyId,
      tokenId: row.tokenId,
      primaryId,
      uiRowRole: row.role,
      nextRoleRaw,
      nextRole,
      shareEmail: row.shareEmail || row.email || null,
      loginUsername: row.loginUsername || null,
    });

    setRoleBusyTokenId(row.tokenId);
    // Optimistic UI — same-session Select turant nayi role dikhaye.
    setUserRows((prev) =>
      prev.map((r) => (r.tokenId === row.tokenId ? { ...r, role: nextRole } : r))
    );
    try {
      await withLocalCompanyUsersWriteLock(effectiveCompanyId, async () => {
        const doc = await getLocalCompanyById(effectiveCompanyId, { includeDeleted: true });
        if (!doc) throw new Error("Local company not found");
        const prev = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown }).localCompanyUsers);
        const matches = matchLocalUsersForShareRow(prev, row, fallbackName);
        plRoleLog("lock_read", {
          companyId: effectiveCompanyId,
          userCount: prev.length,
          matchCount: matches.length,
          matchIds: matches.map((m) => m.id),
          matchRolesBefore: matches.map((m) => ({ id: m.id, role: m.role })),
          allUsersBefore: plRoleUsersSummary(prev),
          storageOption: (doc as { storageOption?: string }).storageOption ?? null,
          plServerShared: (doc as { plServerShared?: boolean }).plServerShared ?? null,
        });
        if (!matches.length) {
          plRoleLog("abort_no_match", { companyId: effectiveCompanyId, tokenId: row.tokenId });
          toast({ variant: "destructive", title: "User not found in local company" });
          await refreshUserRows({ silent: true });
          return;
        }
        // Always include token primary id — Manager save miss kabhi duplicate-match pe depend na kare.
        const matchIds = new Set(matches.map((u) => u.id));
        if (primaryId) matchIds.add(primaryId);
        const already = [...matchIds].every((id) => {
          const m = prev.find((u) => u.id === id);
          return m ? normalizeLocalCompanyAppRole(m.role) === nextRole : false;
        });
        if (already) {
          plRoleLog("skip_already_saved", {
            companyId: effectiveCompanyId,
            nextRole,
            matchIds: [...matchIds],
          });
          await refreshUserRows({ silent: true });
          return;
        }

        const writeAndVerify = async (
          attempt: number
        ): Promise<{
          ok: boolean;
          users: ReturnType<typeof parseLocalCompanyUserRows>;
          perm: unknown;
        }> => {
          const fresh = await getLocalCompanyById(effectiveCompanyId, { includeDeleted: true });
          if (!fresh) {
            plRoleLog("write_fail_no_doc", { attempt, companyId: effectiveCompanyId });
            return { ok: false, users: [], perm: null };
          }
          const base = parseLocalCompanyUserRows(
            (fresh as { localCompanyUsers?: unknown }).localCompanyUsers
          );
          const nextUsers = base.map((u) =>
            matchIds.has(u.id)
              ? { ...u, role: nextRole }
              : { ...u, role: normalizeLocalCompanyAppRole(u.role) }
          );
          plRoleLog("write_before_upsert", {
            attempt,
            nextRole,
            matchIds: [...matchIds],
            nextUsersTarget: plRoleUsersSummary(nextUsers.filter((u) => matchIds.has(u.id))),
          });
          await upsertLocalCompany({
            ...(fresh as LocalCompanyDoc),
            id: effectiveCompanyId,
            localCompanyUsers: nextUsers,
            updatedAt: Date.now(),
          });
          await flushPendingBrowserDbSave();
          plRoleLog("idb_flush_done", { attempt, nextRole, companyId: effectiveCompanyId });
          const verify = await getLocalCompanyById(effectiveCompanyId, { includeDeleted: true });
          const verifiedUsers = parseLocalCompanyUserRows(
            (verify as { localCompanyUsers?: unknown } | null)?.localCompanyUsers
          );
          const perId = [...matchIds].map((id) => {
            const v = verifiedUsers.find((u) => u.id === id);
            return {
              id,
              role: v?.role ?? null,
              normalized: v ? normalizeLocalCompanyAppRole(v.role) : null,
              ok: Boolean(v && normalizeLocalCompanyAppRole(v.role) === nextRole),
            };
          });
          const ok = perId.every((x) => x.ok);
          plRoleLog("write_verify", {
            attempt,
            ok,
            nextRole,
            perId,
            allUsersAfter: plRoleUsersSummary(verifiedUsers),
          });
          const perm =
            (verify as { permissionConfig?: unknown } | null)?.permissionConfig ??
            (fresh as { permissionConfig?: unknown }).permissionConfig;
          return { ok, users: verifiedUsers.length ? verifiedUsers : nextUsers, perm };
        };

        let result = await writeAndVerify(1);
        // Sirf verify fail pe ek retry — manager special double-write race badhata tha.
        if (!result.ok) {
          plRoleLog("rewrite_retry", { reason: "verify_failed", nextRole });
          await new Promise<void>((r) => window.setTimeout(() => r(), 80));
          result = await writeAndVerify(2);
        }
        if (!result.ok) {
          plRoleLog("abort_verify_failed", { companyId: effectiveCompanyId, nextRole });
          toast({
            variant: "destructive",
            title: "Role save verify failed",
            description: "SQLite me role confirm nahi hua — try again.",
          });
          await refreshUserRows({ silent: true });
          return;
        }

        // Hidden PL bridge / sibling tabs: stale sql.js drop — IDB me naya role rahe.
        try {
          const { notifySiblingRenderersReloadBrowserDbFromIndexedDb } = await import(
            "@/lib/localSqlite"
          );
          notifySiblingRenderersReloadBrowserDbFromIndexedDb({
            companyId: effectiveCompanyId,
            nextRole,
            source: "pl_host_role_save",
          });
        } catch {
          /* ignore */
        }

        const { notifyPlServerHostCompanyMetaSaved, PL_SERVER_COMPANY_META_UPDATED_EVENT } =
          await import("@/lib/plServerCompanyMetaSync");
        plRoleLog("meta_bump_start", {
          companyId: effectiveCompanyId,
          nextRole,
          pushUsers: plRoleUsersSummary(result.users),
        });
        await notifyPlServerHostCompanyMetaSaved(effectiveCompanyId, {
          localCompanyUsers: result.users,
          ...(result.perm && typeof result.perm === "object"
            ? { permissionConfig: result.perm }
            : {}),
        });
        plRoleLog("meta_bump_done", { companyId: effectiveCompanyId, nextRole });
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(PL_SERVER_COMPANY_META_UPDATED_EVENT, {
              detail: {
                companyId: effectiveCompanyId,
                localCompanyUsers: result.users,
              },
            })
          );
        }
        bumpLocalCompanyRegistry();
        toast({
          title: "Role updated",
          description: `${matches[0]?.displayName || row.name} → ${localCompanyAppRoleLabel(nextRole)}`,
        });
        await new Promise<void>((r) => window.setTimeout(() => r(), 50));
        await refreshUserRows({ silent: true });
        // Post-refresh: UI list me kya padha — permanent save miss yahin dikhega.
        try {
          const afterDoc = await getLocalCompanyById(effectiveCompanyId, { includeDeleted: true });
          const afterUsers = parseLocalCompanyUserRows(
            (afterDoc as { localCompanyUsers?: unknown } | null)?.localCompanyUsers
          );
          const primary = primaryId ? afterUsers.find((u) => u.id === primaryId) : null;
          plRoleLog("after_refresh_sqlite", {
            companyId: effectiveCompanyId,
            wanted: nextRole,
            primaryId,
            primaryRole: primary?.role ?? null,
            primaryOk: primary
              ? normalizeLocalCompanyAppRole(primary.role) === nextRole
              : false,
            allUsers: plRoleUsersSummary(afterUsers),
          });
        } catch (e) {
          plRoleLog("after_refresh_read_error", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
        onUsersChanged?.();
        plRoleLog("done", { companyId: effectiveCompanyId, nextRole });
      });
    } catch (e) {
      plRoleLog("error", {
        companyId: effectiveCompanyId,
        nextRole,
        error: e instanceof Error ? e.message : String(e),
      });
      toast({
        variant: "destructive",
        title: "Role update failed",
        description: e instanceof Error ? e.message : "Try again.",
      });
      await refreshUserRows({ silent: true });
    } finally {
      setRoleBusyTokenId(null);
    }
  };

  const isManageShare = variant === "manageShare";
  const panelLoading = loading || companiesLoading;
  const routeTitle = routeTab === "server" ? "Share company on PL Server" : "Shared users on Google Drive";
  const routeHelp =
    routeTab === "server"
      ? "These users can open this local company through PL Server. Google Drive sharing is managed separately."
      : "These users are shared through Google Drive for this local company. PL Server sharing is separate.";
  const bluePillClass =
    "rounded-full border border-blue-300 bg-blue-50/90 text-blue-900 hover:bg-blue-100 hover:text-blue-950 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:bg-blue-900/50";
  const activeBluePillClass =
    "rounded-full !border-emerald-300 !bg-emerald-100/90 !text-emerald-950 hover:!bg-emerald-200/80 dark:!border-emerald-700 dark:!bg-emerald-950/45 dark:!text-emerald-100 dark:hover:!bg-emerald-900/55";
  const softBluePillClass =
    "inline-flex h-8 items-center rounded-full border border-blue-300 bg-blue-50/90 px-3 text-xs font-medium text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100";
  const activeTabStyle = {
    backgroundColor: "#d1fae5",
    borderColor: "#6ee7b7",
    color: "#064e3b",
  };
  const sharePanelClass =
    "pl-backup-soft-box pl-backup-soft-box-sky rounded-lg border border-sky-200/70 bg-sky-50/30";
  const shareTableClass =
    "[&_thead_tr]:!border-b-[1px] [&_thead_tr]:!border-sky-200/70 [&_th]:bg-sky-100/80 [&_th]:font-medium [&_th]:text-sky-950 [&_tbody_tr]:!border-b-[1px] [&_tbody_tr]:!border-sky-200/60 [&_tbody_tr:last-child]:border-b-0 [&_tbody_tr:hover]:bg-sky-50/40";
  const ownerCount = ownerEmail ? 1 : 0;
  const driveUserCount = driveRouteRows.length + ownerCount;
  const serverUserCount = displayedUserRows.length + ownerCount;
  const totalUserCount = new Set(
    [
      ...(ownerEmail ? [normalizeEmail(ownerEmail)] : []),
      ...driveRouteRows.map((row) => normalizeEmail(row.email)),
      ...displayedUserRows.map((row) => normalizeEmail(row.shareEmail || row.email)),
    ].filter(Boolean)
  ).size;
  const renderCompanyPill = () =>
    onCompanySelect && companySelectOptions.length > 0 ? (
      <Select
        value={effectiveCompanyId || undefined}
        onValueChange={onCompanySelect}
        disabled={disabled || busy || panelLoading}
      >
        <SelectTrigger
          className={cn(
            softBluePillClass,
            "h-8 w-auto min-w-[11rem] max-w-[18rem] justify-between rounded-full bg-blue-50/90 px-3 py-0 text-xs"
          )}
        >
          <SelectValue placeholder="Select company" />
        </SelectTrigger>
        <SelectContent>
          {companySelectOptions.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <span className={softBluePillClass}>{effectiveCompanyName}</span>
    );

  if (!hostShareable && !companiesLoading) {
    return (
      <p className="text-xs text-amber-700">
        {effectiveCompanyId
          ? "Selected company is not available in this device SQLite yet."
          : "Header se company select karein. Server users manually IP:port add karke company open karenge."}
      </p>
    );
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 hidden md:block">
          {isManageShare ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                {routeTitle}
                <CloudSyncHelpPopover label={routeTitle} description={<p>{routeHelp}</p>} />
              </p>
              {renderCompanyPill()}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                {routeTitle}
                <CloudSyncHelpPopover label={routeTitle} description={<p>{routeHelp}</p>} />
              </span>
              {renderCompanyPill()}
            </div>
          )}
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 md:ml-auto md:w-auto">
          <div className="min-w-0 flex-1 md:hidden">{renderCompanyPill()}</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("h-8 px-3", routeTab === "server" ? activeBluePillClass : bluePillClass)}
            style={routeTab === "server" ? activeTabStyle : undefined}
            onClick={() => setRouteTab("server")}
          >
            Server User {serverUserCount}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("h-8 px-3", routeTab === "drive" ? activeBluePillClass : bluePillClass)}
            style={routeTab === "drive" ? activeTabStyle : undefined}
            onClick={() => setRouteTab("drive")}
          >
            Drive User {driveUserCount}
          </Button>
          <span className={softBluePillClass}>Total User {totalUserCount}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("h-8 shrink-0 px-2.5 text-xs", bluePillClass)}
            disabled={disabled || busy || panelLoading || selectedCompanyIds.length === 0 || routeTab !== "server"}
            onClick={() => setAddOpen(true)}
          >
            <PlusCircle className="mr-1 h-3.5 w-3.5" />
            Add Person
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "overflow-x-auto rounded-md",
          isManageShare ? cn(sharePanelClass, "rounded-md") : sharePanelClass
        )}
      >
        {panelLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
          </div>
        ) : (
          <Table
            scrollContainer={false}
            className={shareTableClass}
          >
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Companies</TableHead>
                <TableHead className="min-w-[7.5rem]">Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ownerEmail ? (
                <TableRow>
                  <TableCell>
                    {(() => {
                      const ownerProfile =
                        profileByEmailRef.current.get(normalizeEmail(ownerEmail)) ||
                        appUsers.find((u) => normalizeEmail(u.email) === normalizeEmail(ownerEmail));
                      const ownerOnline = isUserOnline(ownerProfile) ||
                        isUserOnline({
                          id: customUser?.uid || user?.uid || "current-user",
                          online: customUser?.online,
                          lastSeen: customUser?.lastSeen as AppUserProfile["lastSeen"],
                        });
                      return (
                        <div className="flex items-center gap-2">
                          <UserAvatarWithPresence
                            seed={ownerEmail}
                            photoURL={user?.photoURL || ownerProfile?.photoURL}
                            isOnline={ownerOnline}
                            fallbackInitials={initials(user?.displayName || ownerEmail)}
                          />
                          <div className="min-w-0">
                            <div className="text-sm truncate">{ownerEmail}</div>
                            <span className="text-[10px] font-bold text-amber-700 flex items-center gap-0.5">
                              <Crown className="h-3 w-3" /> OWNER
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>{user?.displayName || "Owner"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">Host (this company)</TableCell>
                  <TableCell className="text-xs text-muted-foreground">Owner</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                </TableRow>
              ) : null}
              {routeTab === "drive"
                ? driveRouteRows.map((row) => (
                    <TableRow key={`drive:${row.email}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserAvatarWithPresence
                            seed={row.email}
                            photoURL={profileByEmailRef.current.get(normalizeEmail(row.email))?.photoURL}
                            isOnline={isUserOnline(profileByEmailRef.current.get(normalizeEmail(row.email)))}
                            fallbackInitials={initials(row.name || row.email)}
                          />
                          <span className="text-sm truncate">{row.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{row.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{row.route}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.role}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">Drive</TableCell>
                    </TableRow>
                  ))
                : displayedUserRows.map((row) => {
                const profile = resolveAppUserForRow(row, appUsers, profileByEmailRef.current);
                const name = profile?.displayName || row.name;
                const displayContact =
                  profile?.email || row.shareEmail || row.email || row.loginUsername || "—";
                const avatarSeed =
                  row.shareEmail || row.email || row.loginUsername || row.name;
                const userOnline = isUserOnline(profile);
                return (
                  <TableRow key={row.tokenId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatarWithPresence
                          seed={avatarSeed}
                          photoURL={profile?.photoURL}
                          isOnline={userOnline}
                          fallbackInitials={initials(name || avatarSeed)}
                        />
                        <span className="text-sm truncate">{displayContact}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                      {effectiveCompanyName}
                    </TableCell>
                    <TableCell className="min-w-[7.5rem]">
                      <Select
                        value={normalizeLocalCompanyAppRole(row.role)}
                        onValueChange={(v) => void updateUserRole(row, v, name)}
                        disabled={disabled || !!busyEmail || roleBusyTokenId === row.tokenId}
                      >
                        <SelectTrigger className="h-8 w-full min-w-[6.75rem] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LOCAL_COMPANY_APP_ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={disabled || !!busyEmail}
                          title="Refresh server access state"
                          onClick={() => void refreshUserAccess(row)}
                        >
                          {busyEmail === row.email ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={disabled || !!busyEmail}
                          title="Edit login password"
                          onClick={() => void openEditUser(row, name)}
                        >
                          <Pencil className="h-4 w-4 text-blue-700" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={disabled || !!busyEmail}
                          title="Remove access"
                          onClick={() => openRemoveUserDialog(row)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {routeTab === "drive" && driveRouteRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                    No Drive shared users for this company.
                  </TableCell>
                </TableRow>
              ) : null}
              {routeTab === "server" && !displayedUserRows.length && !ownerEmail ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                    No users yet. Click Add Person to create a local login.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog
        open={!!removeUserRow}
        onOpenChange={(open) => {
          if (!open) closeRemoveUserDialog();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove shared user</DialogTitle>
            <DialogDescription>
              This will remove access only for this user on <strong>{effectiveCompanyName}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="text-muted-foreground">User</div>
              <div className="font-medium">
                {removeUserRow?.shareEmail || removeUserRow?.email || removeUserRow?.loginUsername || removeUserRow?.name}
              </div>
            </div>
            <div className="space-y-2 rounded-md border bg-white/60 px-3 py-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={removeUserDeleteData}
                  onChange={(event) => setRemoveUserDeleteData(event.currentTarget.checked)}
                  disabled={disabled || panelLoading || !!busyEmail}
                  className="h-4 w-4"
                />
                Delete data on this user&apos;s PC
              </label>
              {removeUserDeleteData ? (
                <Select
                  value={removeUserDeleteDelay}
                  onValueChange={(value) => setRemoveUserDeleteDelay(value as CompanyClientDataDeleteDelay)}
                  disabled={disabled || panelLoading || !!busyEmail}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_CLIENT_DATA_DELETE_DELAYS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeRemoveUserDialog} disabled={!!busyEmail}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmRemoveUser()}
              disabled={disabled || panelLoading || !!busyEmail || !removeUserRow}
            >
              {busyEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Remove user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={routeConflictOpen} onOpenChange={setRouteConflictOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>User already shared on Google Drive</DialogTitle>
            <DialogDescription>
              This user is already shared through Google Drive for this company. A user can be shared through either
              Google Drive or PL Server, but not both.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Change method to PL Server will remove this user from the Drive share list on this company, then add PL
            Server access.
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={routeConflictBusy}
              onClick={() => setRouteConflictOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={routeConflictBusy} onClick={() => void changeMethodToPlServer()}>
              {routeConflictBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Change method to PL Server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share local server access</DialogTitle>
            <DialogDescription>
              This only creates a local username/password. User will manually add the server IP:port in Gate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Company: </span>
              <strong>{effectiveCompanyName}</strong>
            </div>
            <div className="space-y-1">
              <Label>Gmail</Label>
              <Input
                type="email"
                placeholder="staff@gmail.com"
                value={shareEmail}
                onChange={(e) => {
                  const value = e.target.value;
                  setShareEmail(value);
                  if (value.includes("@")) {
                    const prefix = value.split("@")[0] || "";
                    if (!loginUsername.trim()) setLoginUsername(prefix);
                    if (!displayName.trim()) setDisplayName(prefix);
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Display name</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Staff name" />
            </div>
            <div className="space-y-1">
              <Label>Login username (on shared companies)</Label>
              <Input value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-9 w-9"
                  onClick={() => setShowPw((v) => !v)}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCAL_COMPANY_APP_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleShare()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit server login</DialogTitle>
            <DialogDescription>
              Update the username, role, or password this user enters after adding the server IP:port in Gate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Gmail: </span>
              <strong>{editTokenRow?.email || "-"}</strong>
            </div>
            <div className="space-y-1">
              <Label>Display name</Label>
              <Input
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                placeholder="Staff name"
              />
            </div>
            <div className="space-y-1">
              <Label>Login username</Label>
              <Input
                value={editLoginUsername}
                onChange={(e) => setEditLoginUsername(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label>{editUserId ? "New password (blank = keep old)" : "Password"}</Label>
              <div className="relative">
                <Input
                  type={editShowPw ? "text" : "password"}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-9 w-9"
                  onClick={() => setEditShowPw((v) => !v)}
                >
                  {editShowPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCAL_COMPANY_APP_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={editBusy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveEditedUser()} disabled={editBusy}>
              {editBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
