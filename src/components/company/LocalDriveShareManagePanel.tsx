"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User as FirebaseUser } from "@/lib/pbCompat/auth";
import { collection, query, where } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useAuth } from "@/hooks/useAuth";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Crown, Eye, EyeOff, KeyRound, Loader2, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import {
  readCloudSyncDriveShareUsers,
  shareUsersToEmailList,
} from "@/lib/localCloudSync/companyConfig";
import { revokeDriveFolderShare, shareDriveFolderUser, persistShareUserProfilesToLocalCompany } from "@/lib/localCloudSync/driveCloudSyncClient";
import type { CloudSyncDriveShareUser } from "@/lib/localCloudSync/types";
import {
  LOCAL_COMPANY_APP_ROLES,
  localCompanyAppRoleLabel,
  normalizeLocalCompanyAppRole,
  type LocalCompanyAppRole,
} from "@/lib/localCompanyAppRoles";
import {
  mergeDriveShareUsersIntoLocalCompanyUsers,
  parseLocalCompanyUserRows,
  removeDriveShareUserFromLocalCompanyUsers,
  updateLocalCompanyUserClient,
  upsertUserInList,
} from "@/lib/localCompanyUsers";
import { AddLocalCompanyUserDialog } from "@/components/company/AddLocalCompanyUserDialog";
import { CloudSyncHelpPopover } from "@/components/company/CloudSyncHelpPopover";
import { runLocalCloudSyncCycle } from "@/lib/localCloudSync/engine";
import type { Company } from "@/hooks/useCompany";
import { cn } from "@/lib/utils";
import {
  fetchAppUserProfilesByEmails,
  normalizeGooglePhotoUrl,
} from "@/lib/batchFetchUserDisplayNames";
import {
  companyProfileGreenZone,
} from "@/lib/companyProfileChrome";

type Props = {
  companyId: string;
  companyName?: string;
  company: Record<string, unknown>;
  companyOptions?: Array<{ id: string; name?: string }>;
  onCompanySelect?: (companyId: string) => void;
  /** Cloud sync right column — thoda compact table */
  variant?: "panel" | "full";
  disabled?: boolean;
  onUsersChanged?: () => void;
};

type ShareRow = {
  email: string;
  name: string;
  role: LocalCompanyAppRole | "owner";
  localUserId?: string;
  loginUsername?: string;
  photoURL?: string;
};

type RouteTab = "drive" | "server";

type AppUserProfile = {
  email?: string;
  photoURL?: string;
  displayName?: string;
};

const normalizeEmail = (email?: string) => String(email || "").trim().toLowerCase();

type SharedWithProfileRow = {
  email?: string;
  name?: string;
  displayName?: string;
  photoURL?: string;
};

/** Parent context refresh se SQLite wali photo/name mat hatao. */
function mergeSharedWithPreserveProfiles(
  prev: SharedWithProfileRow[],
  next: SharedWithProfileRow[]
): SharedWithProfileRow[] {
  const byEmail = new Map<string, SharedWithProfileRow>();
  for (const row of next) {
    const key = normalizeEmail(row.email);
    if (!key.includes("@")) continue;
    byEmail.set(key, { ...row, email: key });
  }
  for (const row of prev) {
    const key = normalizeEmail(row.email);
    if (!key.includes("@")) continue;
    const incoming = byEmail.get(key);
    if (!incoming) {
      byEmail.set(key, { ...row, email: key });
      continue;
    }
    byEmail.set(key, {
      ...incoming,
      photoURL: incoming.photoURL || row.photoURL,
      displayName: incoming.displayName || incoming.name || row.displayName || row.name,
      name: incoming.name || incoming.displayName || row.name || row.displayName,
    });
  }
  return [...byEmail.values()];
}

function photoFromUserDoc(data: Record<string, unknown>): string | undefined {
  for (const key of ["photoURL", "photoUrl", "avatarUrl", "avatar"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return normalizeGooglePhotoUrl(v);
  }
  return undefined;
}

/** Firebase / Google photo; fallback dicebear PNG (SVG Radix Avatar me fail ho sakta hai). */
const dicebearAvatarUrl = (email: string) =>
  `https://api.dicebear.com/7.x/initials/png?seed=${encodeURIComponent(email)}&size=96`;

function profileForEmail(
  email: string,
  appUsers: AppUserProfile[],
  firebaseUser: FirebaseUser | null,
  sharedWith: Array<{ email?: string; photoURL?: string; name?: string; displayName?: string }>,
  profileCache?: Map<string, AppUserProfile>
): { photoURL?: string; displayName?: string } {
  const em = normalizeEmail(email);

  // Signed-in Firebase Auth user — customUser me photoURL nahi hota, yahan se lo.
  if (firebaseUser?.email && normalizeEmail(firebaseUser.email) === em) {
    const photoURL = normalizeGooglePhotoUrl(firebaseUser.photoURL);
    const displayName = String(firebaseUser.displayName || "").trim() || undefined;
    if (photoURL || displayName) return { photoURL, displayName };
  }

  const cached = profileCache?.get(em);
  if (cached?.photoURL || cached?.displayName) {
    return {
      photoURL: normalizeGooglePhotoUrl(cached.photoURL),
      displayName: cached.displayName?.trim() || undefined,
    };
  }

  const sw = sharedWith.find((u) => normalizeEmail(u.email) === em);
  if (sw) {
    const photoURL = normalizeGooglePhotoUrl(sw.photoURL);
    const displayName = String(sw.displayName || sw.name || "").trim() || undefined;
    if (photoURL || displayName) return { photoURL, displayName };
  }

  const u = appUsers.find((x) => normalizeEmail(x.email) === em);
  if (!u) return {};
  return {
    photoURL: normalizeGooglePhotoUrl(u.photoURL),
    displayName: u.displayName?.trim() || undefined,
  };
}

const getInitials = (nameOrEmail: string) => {
  const s = (nameOrEmail || "").trim();
  if (!s) return "U";
  const parts = s.includes("@") ? s.split("@")[0].split(/[.\s_-]+/) : s.split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "U";
};

/** Avatar — Google photo fail ho to dicebear, phir initials fallback. */
function ShareUserAvatar({ email, name, photoURL }: { email: string; name: string; photoURL?: string }) {
  const primary = normalizeGooglePhotoUrl(photoURL);
  const fallback = dicebearAvatarUrl(email);
  const [src, setSrc] = useState(primary || fallback);

  useEffect(() => {
    setSrc(primary || fallback);
  }, [primary, fallback]);

  return (
    <Avatar className="h-8 w-8 shrink-0 border">
      <AvatarImage
        src={src}
        className="object-cover"
        alt=""
        referrerPolicy="no-referrer"
        onLoadingStatusChange={(status) => {
          if (status === "error" && src !== fallback) setSrc(fallback);
        }}
      />
      <AvatarFallback className="text-[10px]">{getInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** Drive share list + local users — Manage Sharing jaisa table (app role; Drive writer). */
export function LocalDriveShareManagePanel({
  companyId,
  companyName,
  company,
  companyOptions,
  onCompanySelect,
  variant = "panel",
  disabled,
  onUsersChanged,
}: Props) {
  const { toast } = useToast();
  const { user: firebaseUser } = useAuth();
  const [appUsers, setAppUsers] = useState<AppUserProfile[]>([]);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<ShareRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<LocalCompanyAppRole>("manager");
  const [editLogin, setEditLogin] = useState("");
  // Edit dialog — optional naya password; khali = purana hi rahega.
  const [editPassword, setEditPassword] = useState("");
  const [editShowPassword, setEditShowPassword] = useState(false);
  const [passwordRow, setPasswordRow] = useState<ShareRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [routeTab, setRouteTab] = useState<RouteTab>("drive");
  const [tick, setTick] = useState(0);
  const [localCompany, setLocalCompany] = useState<Record<string, unknown>>(company);
  const profileCacheRef = useRef<Map<string, AppUserProfile>>(new Map());

  useEffect(() => {
    setLocalCompany((prev) => {
      const prevShared = Array.isArray(prev.sharedWith)
        ? (prev.sharedWith as SharedWithProfileRow[])
        : [];
      const nextShared = Array.isArray((company as { sharedWith?: unknown }).sharedWith)
        ? ((company as { sharedWith: SharedWithProfileRow[] }).sharedWith as SharedWithProfileRow[])
        : [];
      return {
        ...prev,
        ...company,
        sharedWith: mergeSharedWithPreserveProfiles(prevShared, nextShared),
      };
    });
  }, [company]);

  // Parent callback stable ref — har render par naya inline fn se refresh loop na ho.
  const onUsersChangedRef = useRef(onUsersChanged);
  onUsersChangedRef.current = onUsersChanged;

  const reloadLocalState = useCallback(async () => {
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    if (reg) setLocalCompany(reg as Record<string, unknown>);
    setTick((n) => n + 1);
  }, [companyId]);

  const notifyParentRegistry = useCallback(() => {
    onUsersChangedRef.current?.();
  }, []);

  /** SQLite update ke baad local table + parent context ek baar refresh. */
  const refreshAfterMutation = useCallback(async () => {
    await reloadLocalState();
    notifyParentRegistry();
  }, [reloadLocalState, notifyParentRegistry]);

  useEffect(() => {
    void reloadLocalState();
  }, [reloadLocalState]);

  /** Share list emails — Firestore query case-sensitive; registry wala casing rakho. */
  const shareEmails = useMemo(() => {
    void tick;
    const owner = String(localCompany.ownerEmail || "").trim();
    const fromShare = readCloudSyncDriveShareUsers(localCompany).map((u) => u.email.trim());
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of [owner, ...fromShare]) {
      if (!e.includes("@")) continue;
      const key = e.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  }, [localCompany, tick]);

  /** Firestore `email` query case-sensitive — original + lowercase dono batch me. */
  const shareEmailsForQuery = useMemo(() => {
    const variants = new Set<string>();
    for (const e of shareEmails) {
      const t = e.trim();
      if (!t.includes("@")) continue;
      variants.add(t);
      variants.add(t.toLowerCase());
    }
    return [...variants];
  }, [shareEmails]);

  const sharedWithRows = useMemo(() => {
    const raw = localCompany.sharedWith;
    return Array.isArray(raw) ? (raw as Array<{ email?: string; photoURL?: string; name?: string; displayName?: string }>) : [];
  }, [localCompany.sharedWith]);

  useEffect(() => {
    if (!firebaseUser || shareEmailsForQuery.length === 0) {
      return;
    }
    const chunk = (arr: string[], size: number) =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
    const unsubs: Array<() => void> = [];
    for (const batch of chunk(shareEmailsForQuery, 10)) {
      const qy = query(collection(firestore, "users"), where("email", "in", batch));
      const unsub = onSnapshot(qy, (snap) => {
        setAppUsers((prev) => {
          const map = new Map(prev.map((x) => [normalizeEmail(x.email), x]));
          for (const d of snap.docs) {
            const data = d.data() as Record<string, unknown>;
            const email = normalizeEmail(String(data.email ?? ""));
            if (!email) continue;
            const row = {
              email,
              photoURL: photoFromUserDoc(data),
              displayName: typeof data.displayName === "string" ? data.displayName : undefined,
            };
            map.set(email, row);
            profileCacheRef.current.set(email, row);
          }
          return Array.from(map.values());
        });
      });
      unsubs.push(unsub);
    }
    return () => unsubs.forEach((u) => u());
  }, [firebaseUser, shareEmailsForQuery]);

  // Snapshot miss (email casing / legacy doc id) — profile fetch + SQLite me persist.
  useEffect(() => {
    if (!firebaseUser || shareEmails.length === 0) return;
    let cancelled = false;
    void (async () => {
      const fetched = await fetchAppUserProfilesByEmails(shareEmails);
      if (cancelled) return;
      if (fetched.length > 0) {
        for (const p of fetched) {
          const key = normalizeEmail(p.email);
          const existing = profileCacheRef.current.get(key);
          profileCacheRef.current.set(key, {
            email: key,
            photoURL: p.photoURL || existing?.photoURL,
            displayName: p.displayName || existing?.displayName,
          });
        }
        setAppUsers((prev) => {
          const map = new Map(prev.map((x) => [normalizeEmail(x.email), x]));
          for (const p of fetched) {
            const key = normalizeEmail(p.email);
            const existing = map.get(key);
            map.set(key, {
              email: key,
              photoURL: p.photoURL || existing?.photoURL,
              displayName: p.displayName || existing?.displayName,
            });
          }
          return Array.from(map.values());
        });
        const persisted = await persistShareUserProfilesToLocalCompany(companyId, fetched);
        if (persisted && !cancelled) {
          await reloadLocalState();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, shareEmails, tick, companyId, reloadLocalState]);

  const rows = useMemo((): ShareRow[] => {
    void tick;
    const ownerEmail = normalizeEmail(String(localCompany.ownerEmail || ""));
    const shareUsers = readCloudSyncDriveShareUsers(localCompany);
    const localUsers = parseLocalCompanyUserRows(localCompany.localCompanyUsers);
    const out: ShareRow[] = [];

    if (ownerEmail.includes("@")) {
      const ownerLocal = localUsers.find((u) => normalizeEmail(u.username) === ownerEmail);
      const ownerProfile = profileForEmail(ownerEmail, appUsers, firebaseUser, sharedWithRows, profileCacheRef.current);
      out.push({
        email: ownerEmail,
        name: ownerLocal?.displayName || ownerProfile.displayName || ownerEmail.split("@")[0] || "Owner",
        role: "owner",
        localUserId: ownerLocal?.id,
        loginUsername: ownerLocal?.username,
        photoURL: ownerProfile.photoURL,
      });
    }

    for (const su of shareUsers) {
      if (su.email === ownerEmail) continue;
      const localByGmail = localUsers.find((u) => normalizeEmail(u.username) === su.email);
      const localByAny = localUsers.find(
        (u) => normalizeEmail(u.displayName) === su.email || normalizeEmail(u.username) === su.email
      );
      const profile = profileForEmail(su.email, appUsers, firebaseUser, sharedWithRows, profileCacheRef.current);
      const sharedRow = sharedWithRows.find((u) => normalizeEmail(u.email) === su.email);
      out.push({
        email: su.email,
        name:
          localByGmail?.displayName ||
          localByAny?.displayName ||
          profile.displayName ||
          sharedRow?.displayName ||
          sharedRow?.name ||
          su.email.split("@")[0] ||
          su.email,
        role: normalizeLocalCompanyAppRole(su.appRole),
        localUserId: localByGmail?.id || localByAny?.id,
        loginUsername: localByGmail?.username || localByAny?.username,
        photoURL: profile.photoURL || sharedRow?.photoURL,
      });
    }
    return out;
  }, [localCompany, tick, appUsers, firebaseUser, sharedWithRows]);

  const serverRows = useMemo((): ShareRow[] => {
    const ownerEmail = normalizeEmail(String(localCompany.ownerEmail || ""));
    const driveEmails = new Set(readCloudSyncDriveShareUsers(localCompany).map((u) => normalizeEmail(u.email)));
    const ownerProfile = ownerEmail
      ? profileForEmail(ownerEmail, appUsers, firebaseUser, sharedWithRows, profileCacheRef.current)
      : null;
    const out: ShareRow[] = ownerEmail
      ? [
          {
            email: ownerEmail,
            name:
              ownerProfile?.displayName ||
              String(localCompany.ownerName || "").trim() ||
              ownerEmail.split("@")[0] ||
              "Owner",
            role: "owner",
            photoURL: ownerProfile?.photoURL,
          },
        ]
      : [];
    out.push(
      ...parseLocalCompanyUserRows(localCompany.localCompanyUsers)
      .filter((u) => {
        const email = normalizeEmail(u.shareEmail || u.username);
        if (!email.includes("@")) return false;
        if (email === ownerEmail) return false;
        return !driveEmails.has(email);
      })
      .map((u) => {
        const email = normalizeEmail(u.shareEmail || u.username);
        const profile = profileForEmail(email, appUsers, firebaseUser, sharedWithRows, profileCacheRef.current);
        return {
          email,
          name: u.displayName || profile.displayName || email.split("@")[0] || email,
          role: normalizeLocalCompanyAppRole(u.role),
          localUserId: u.id,
          loginUsername: u.username,
          photoURL: profile.photoURL,
        };
      })
    );
    return out;
  }, [localCompany, appUsers, firebaseUser, sharedWithRows]);

  const activeRows = routeTab === "drive" ? rows : serverRows;

  const companyForDialog = useMemo(
    () =>
      ({
        id: companyId,
        name: companyName ?? String(company.name || "Company"),
        storageOption: "local",
        ownerEmail: company.ownerEmail,
      }) as Company,
    [companyId, companyName, company.name, company.ownerEmail]
  );

  const persistShareUsers = async (next: CloudSyncDriveShareUser[], removedEmail?: string) => {
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    if (!reg) return;
    let localCompanyUsers = parseLocalCompanyUserRows((reg as { localCompanyUsers?: unknown }).localCompanyUsers);
    localCompanyUsers = mergeDriveShareUsersIntoLocalCompanyUsers(localCompanyUsers, next);
    if (removedEmail) {
      localCompanyUsers = removeDriveShareUserFromLocalCompanyUsers(localCompanyUsers, removedEmail);
    }
    await upsertLocalCompany({
      ...reg,
      cloudSyncDriveShareUsers: next,
      cloudSyncSharedEmails: shareUsersToEmailList(next),
      localCompanyUsers,
    } as LocalCompanyDoc);
    await refreshAfterMutation();
  };

  const onRoleChange = async (email: string, newRole: LocalCompanyAppRole) => {
    setBusyEmail(email);
    try {
      const shareUsers = readCloudSyncDriveShareUsers(localCompany);
      const next = shareUsers.map((u) =>
        u.email === email ? { ...u, appRole: newRole } : u
      );
      await shareDriveFolderUser({ companyId, companyName, user: { email, appRole: newRole } });
      await persistShareUsers(next);
      toast({ title: "Role updated", description: `${email} → ${localCompanyAppRoleLabel(newRole)}` });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyEmail(null);
    }
  };

  const onNameChange = async (row: ShareRow, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === row.name) return;
    setBusyEmail(row.email);
    try {
      const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
      if (!reg) return;
      let localUsers = parseLocalCompanyUserRows((reg as { localCompanyUsers?: unknown }).localCompanyUsers);
      const idx = localUsers.findIndex((u) => normalizeEmail(u.username) === row.email);
      if (idx >= 0) {
        await updateLocalCompanyUserClient(companyId, localUsers[idx].id, { displayName: trimmed });
      } else {
        localUsers = upsertUserInList(localUsers, {
          username: row.email,
          displayName: trimmed,
          role: row.role === "owner" ? "owner" : row.role,
          password: "",
        });
        await upsertLocalCompany({ ...reg, localCompanyUsers: localUsers } as LocalCompanyDoc);
      }
      await reloadLocalState();
      toast({ title: "Name updated", description: trimmed });
    } finally {
      setBusyEmail(null);
    }
  };

  const onDelete = async (email: string) => {
    setBusyEmail(email);
    try {
      try {
        await revokeDriveFolderShare({ companyId, companyName, email });
      } catch {
        /* list se hatao */
      }
      const next = readCloudSyncDriveShareUsers(localCompany).filter((u) => u.email !== email);
      await persistShareUsers(next, email);
      toast({ title: "User removed", description: `${email} removed from sharing.` });
    } finally {
      setBusyEmail(null);
    }
  };

  const openEdit = (row: ShareRow) => {
    setEditRow(row);
    setEditName(row.name);
    setEditRole(row.role === "owner" ? "manager" : row.role);
    setEditLogin(row.loginUsername || row.email);
    setEditPassword("");
    setEditShowPassword(false);
  };

  const saveEdit = async () => {
    if (!editRow || editRow.role === "owner") return;
    setBusyEmail(editRow.email);
    try {
      const shareUsers = readCloudSyncDriveShareUsers(localCompany);
      const next = shareUsers.map((u) =>
        u.email === editRow.email ? { ...u, appRole: editRole } : u
      );
      await shareDriveFolderUser({ companyId, companyName, user: { email: editRow.email, appRole: editRole } });
      await persistShareUsers(next);
      const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
      const trimmedPassword = editPassword.trim();
      if (reg && editRow.localUserId) {
        await updateLocalCompanyUserClient(companyId, editRow.localUserId, {
          displayName: editName.trim(),
          role: editRole,
          password: trimmedPassword || undefined,
        });
      } else if (reg) {
        let localUsers = parseLocalCompanyUserRows((reg as { localCompanyUsers?: unknown }).localCompanyUsers);
        const existing = localUsers.find((u) => normalizeEmail(u.username) === normalizeEmail(editRow.email));
        localUsers = upsertUserInList(localUsers, {
          username: editRow.email,
          displayName: editName.trim(),
          role: editRole,
          // Naya password diya ho to set; warna purana row ka password preserve.
          password: trimmedPassword || existing?.password || "",
        });
        await upsertLocalCompany({ ...reg, localCompanyUsers: localUsers } as LocalCompanyDoc);
      }
      await refreshAfterMutation();
      setEditRow(null);
      setEditPassword("");
      toast({ title: "User updated" });
      // Password Drive par push — shared device login ke liye.
      void runLocalCloudSyncCycle(companyId, { force: true });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyEmail(null);
    }
  };

  const savePassword = async () => {
    if (!passwordRow?.localUserId) {
      toast({
        variant: "destructive",
        title: "No login user",
        description: "Add this person with Add Person dialog first (username + password).",
      });
      return;
    }
    const p = newPassword.trim();
    if (!p) {
      toast({ variant: "destructive", title: "Password required" });
      return;
    }
    setBusyEmail(passwordRow.email);
    try {
      await updateLocalCompanyUserClient(companyId, passwordRow.localUserId, { password: p });
      toast({ title: "Password updated", description: passwordRow.email });
      setPasswordRow(null);
      setNewPassword("");
      void runLocalCloudSyncCycle(companyId, { force: true });
    } finally {
      setBusyEmail(null);
    }
  };

  const sharedCount = rows.filter((r) => r.role !== "owner").length;
  const isFull = variant === "full";
  const driveUserCount = rows.length;
  const serverUserCount = serverRows.length;
  const totalUserCount = new Set([...rows, ...serverRows].map((row) => normalizeEmail(row.email)).filter(Boolean)).size;
  const routeTitle = routeTab === "drive" ? "Share company on Drive" : "Shared users on PL Server";
  const routeHelp =
    routeTab === "drive"
      ? "Users receive writer access to the Google Drive folder. Their app role is controlled from this table."
      : "These users are shared through PL Server. Drive sharing is separate for this company.";
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
    "pl-backup-soft-box pl-backup-soft-box-sky rounded-lg border border-sky-200/70 bg-sky-50/30 p-3 space-y-3 h-full flex flex-col min-h-0";
  const shareTableClass =
    "[&_thead_tr]:!border-b-[1px] [&_thead_tr]:!border-sky-200/70 [&_th]:bg-sky-100/80 [&_th]:font-medium [&_th]:text-sky-950 [&_tbody_tr]:!border-b-[1px] [&_tbody_tr]:!border-sky-200/60 [&_tbody_tr:last-child]:border-b-0 [&_tbody_tr:hover]:bg-sky-50/40";
  const companyLabel = companyName ?? String(company.name || "Company");
  const renderCompanyPill = () =>
    onCompanySelect && companyOptions?.length ? (
      <Select value={companyId} onValueChange={onCompanySelect} disabled={disabled}>
        <SelectTrigger
          className={cn(
            softBluePillClass,
            "h-8 w-auto min-w-[11rem] max-w-[18rem] justify-between rounded-full bg-blue-50/90 px-3 py-0 text-xs"
          )}
        >
          <SelectValue placeholder="Select company" />
        </SelectTrigger>
        <SelectContent>
          {companyOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name || option.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <span className={softBluePillClass}>{companyLabel}</span>
    );

  return (
    <div
      className={cn(
        "h-full flex flex-col dark:border-black",
        isFull ? "border-0 bg-transparent" : sharePanelClass
      )}
    >
      <div className={cn("flex flex-col gap-2 pb-2", isFull ? "px-0" : "")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Label
              className={cn(
                "inline-flex items-center gap-1.5 font-semibold text-sky-950 dark:text-sky-100",
                isFull ? "text-base" : "text-sm"
              )}
            >
              {isFull ? (
                <>
                  Manage Sharing{" "}
                  <span className="text-muted-foreground font-normal">----&gt;</span>{" "}
                  {companyLabel}
                </>
              ) : (
                routeTitle
              )}
              <CloudSyncHelpPopover
                label={routeTitle}
                description={<p>{routeHelp}</p>}
              />
            </Label>
            {renderCompanyPill()}
          </div>
          <div className="flex flex-row flex-wrap items-center justify-end gap-2 shrink-0">
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
            <span className={softBluePillClass}>Total User {totalUserCount}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("h-8 px-2.5 text-xs", bluePillClass)}
              disabled={disabled || !!busyEmail || routeTab !== "drive"}
              onClick={() => setAddOpen(true)}
            >
              <PlusCircle className="h-3.5 w-3.5 mr-1" />
              Add Person
            </Button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mt-3 min-h-0 flex-1 overflow-x-auto",
          isFull ? companyProfileGreenZone : "rounded-sm",
        )}
      >
        <Table
          className={cn(
            shareTableClass,
            "[&_thead_tr]:shadow-none",
          )}
        >
          <TableHeader className="bg-sky-100/80 dark:bg-sky-950/45">
            <TableRow className="hover:bg-transparent">
              <TableHead className={isFull ? "w-2/5" : "min-w-[140px]"}>Email</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeRows.map((row) => (
              <TableRow key={row.email}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShareUserAvatar email={row.email} name={row.name} photoURL={row.photoURL} />
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm truncate">{row.email}</div>
                      {row.role === "owner" ? (
                        <span className="text-[10px] text-emerald-700 font-bold flex items-center gap-0.5 dark:text-emerald-400">
                          <Crown className="h-3 w-3" /> OWNER
                        </span>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-900 ring-1 ring-blue-200/80 dark:bg-blue-950/40 dark:text-blue-100 dark:ring-blue-800/70">
                    {routeTab === "server" ? "PL Server" : row.role === "owner" ? "Owner" : "Google Drive"}
                  </span>
                </TableCell>
                <TableCell>
                  {row.role === "owner" || routeTab === "server" ? (
                    <span className="text-sm">{row.name}</span>
                  ) : (
                    <Input
                      className="h-8 text-xs sm:text-sm min-w-[80px]"
                      defaultValue={row.name}
                      disabled={disabled || busyEmail === row.email}
                      onBlur={(e) => void onNameChange(row, e.target.value)}
                    />
                  )}
                </TableCell>
                <TableCell>
                  {row.role === "owner" || routeTab === "server" ? (
                    <span className="inline-flex items-center text-sm text-emerald-800 dark:text-emerald-300">
                      {row.role === "owner" ? <Crown className="mr-1 h-3.5 w-3.5" /> : null}
                      {row.role === "owner" ? "Owner" : localCompanyAppRoleLabel(row.role)}
                    </span>
                  ) : (
                    <Select
                      value={row.role}
                      onValueChange={(v) => void onRoleChange(row.email, normalizeLocalCompanyAppRole(v))}
                      disabled={disabled || busyEmail === row.email}
                    >
                      <SelectTrigger className="h-8 w-[120px] text-xs">
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
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.role === "owner" || routeTab === "server" ? (
                    <span className="text-xs text-muted-foreground">{row.role === "owner" ? "Owner" : "Server"}</span>
                  ) : (
                    <div className="flex justify-end gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Edit user"
                        disabled={disabled || !!busyEmail}
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Reset password"
                        disabled={disabled || !!busyEmail}
                        onClick={() => {
                          setPasswordRow(row);
                          setNewPassword("");
                          setShowPassword(false);
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      {busyEmail === row.email ? (
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Remove"
                          disabled={disabled}
                          onClick={() => void onDelete(row.email)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {activeRows.length === 0 ? (
          <p className="text-center text-xs text-emerald-800/75 dark:text-emerald-300/80 p-4">
            {routeTab === "drive"
              ? "No Drive shared users yet. Click Add Person to invite staff."
              : "No PL Server users for this company."}
          </p>
        ) : null}
      </div>

      <AddLocalCompanyUserDialog
        company={companyForDialog}
        companyName={companyName}
        variant="driveShare"
        open={addOpen}
        onOpenChange={setAddOpen}
        onUserAdded={() => void refreshAfterMutation()}
      />

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>{editRow?.email}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Display name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Login username</Label>
              <Input value={editLogin} disabled className="bg-muted" />
            </div>
            <div className="space-y-1.5">
              <Label>App role</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={editRole}
                onChange={(e) => setEditRole(normalizeLocalCompanyAppRole(e.target.value))}
              >
                {LOCAL_COMPANY_APP_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-password">New password (optional)</Label>
              <div className="relative">
                <Input
                  id="edit-user-password"
                  type={editShowPassword ? "text" : "password"}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  autoComplete="new-password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setEditShowPassword((s) => !s)}
                  title={editShowPassword ? "Hide password" : "Show password"}
                >
                  {editShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Local login and Drive decryption key. It changes only when you enter a new password.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} disabled={!!busyEmail}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!passwordRow} onOpenChange={(o) => !o && setPasswordRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password — {passwordRow?.name}</DialogTitle>
            <DialogDescription>
              This password is also used as the Drive decryption key when encryption is enabled.
            </DialogDescription>
          </DialogHeader>
          <div className="relative py-2">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setShowPassword((s) => !s)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPasswordRow(null)}>
              Cancel
            </Button>
            <Button onClick={() => void savePassword()} disabled={!!busyEmail}>
              Set password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
