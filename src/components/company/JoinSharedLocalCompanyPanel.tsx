"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Cloud, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getGoogleDriveAuthUrl,
  openGoogleDriveOAuthUrl,
  resolveDriveOAuthReturnPath,
} from "@/lib/driveAuthClient";
import { markDriveOAuthReturnGrace } from "@/lib/driveOAuthReturnGrace";
import {
  getDriveApiUser,
  isLocalSyntheticAuthUid,
} from "@/lib/firebaseAuthForApi";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import {
  findJoinedLocalCompanyForDriveInvite,
  joinDriveSharedLocalCompany,
  listDriveSharedLocalCompanyInvites,
  preloadDriveSharedCompanyLoginFromInvite,
  resyncDriveLocalCompanyFromInvite,
  type DriveSharedCompanyInvite,
  type DriveSharedJoinCompleteSource,
} from "@/lib/localCloudSync/driveSharedJoinClient";
import { listLocalCompanies, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import {
  CLOUD_SYNC_DRIVE_SALT_MISSING_MSG,
  isCloudSyncEncryptionKeyRequiredError,
} from "@/lib/localCloudSync/driveEncryption";
import { cn } from "@/lib/utils";
import { cloudSyncJoinPanelCard, cloudSyncNestedCard } from "@/lib/companyProfileChrome";
import { CloudSyncHelpPopover } from "@/components/company/CloudSyncHelpPopover";
import { purgeAllLocalCompaniesMissingOnDrive } from "@/lib/localCloudSync/driveCompanyFolderLifecycle";
import { markSuppressFirestorePermissionForCompany } from "@/lib/firestorePermissionSuppress";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";

type Props = {
  /** false = list load mat karo (dialog band) */
  active?: boolean;
  onJoined?: (companyId: string, source?: DriveSharedJoinCompleteSource) => void;
  className?: string;
  /** Drive OAuth ke baad wapas is path par aao */
  returnPath?: string;
  /** dialog ke andar — title/description dialog header se aata hai */
  embedded?: boolean;
};

/** Drive par shared local companies — join list (settings page + dialog dono). */
export function JoinSharedLocalCompanyPanel({
  active = true,
  onJoined,
  className,
  returnPath,
  embedded = false,
}: Props) {
  const { user } = useAuth();
  const { reloadLocalCompanyRegistry, localCompanyRegistryEpoch, companyId } = useCompany();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [invites, setInvites] = useState<DriveSharedCompanyInvite[]>([]);
  const [invitesEverLoaded, setInvitesEverLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Har Drive folder ka alag password — encrypt ON par kaunsi company clear rahe. */
  const [passwordByFolderId, setPasswordByFolderId] = useState<Record<string, string>>({});
  const [localRegistryRows, setLocalRegistryRows] = useState<LocalCompanyDoc[]>([]);
  const driveSyncDisabled = isLocalGoogleDriveSyncDisabled();

  useEffect(() => {
    if (driveSyncDisabled) return;
    setError((prev) => (prev === LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE ? null : prev));
  }, [driveSyncDisabled]);

  const refreshLocalJoinState = useCallback(async () => {
    setLocalRegistryRows(await listLocalCompanies({ includeDeleted: true }));
  }, []);

  const loadInvites = useCallback(async () => {
    if (driveSyncDisabled) {
      setLoading(false);
      setInvites([]);
      setError(LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const purged = await purgeAllLocalCompaniesMissingOnDrive(user?.uid ?? null);
      if (purged.length > 0) {
        reloadLocalCompanyRegistry();
        await refreshLocalJoinState();
      }
      const rows = await listDriveSharedLocalCompanyInvites();
      setInvites(rows);
      setInvitesEverLoaded(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, reloadLocalCompanyRegistry, refreshLocalJoinState, driveSyncDisabled]);

  // Join list: manual Refresh only — auto load se Drive quota (list-shared-companies) mat kharch karo.
  useEffect(() => {
    if (!active) return;
    void refreshLocalJoinState();
  }, [active, refreshLocalJoinState, localCompanyRegistryEpoch]);

  // Drive-shared local rows — Firestore registry listeners deny expected; dev overlay suppress.
  useEffect(() => {
    if (!active) return;
    for (const row of localRegistryRows) {
      if ((row as { driveSharedJoin?: boolean }).driveSharedJoin === true && row.id) {
        markSuppressFirestorePermissionForCompany(String(row.id));
        break;
      }
    }
  }, [active, localRegistryRows]);

  const ownedInvites = useMemo(() => invites.filter((inv) => inv.isOwnedOnDrive), [invites]);
  const visibleError =
    !driveSyncDisabled && error === LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE ? null : error;

  const groupedBySharer = useMemo(() => {
    const map = new Map<string, DriveSharedCompanyInvite[]>();
    for (const inv of invites) {
      if (inv.isOwnedOnDrive) continue;
      const key = inv.sharedByEmail.toLowerCase();
      const list = map.get(key) ?? [];
      list.push(inv);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [invites]);

  const hasAnyInvites = ownedInvites.length > 0 || groupedBySharer.length > 0;

  const connectDrive = async () => {
    if (driveSyncDisabled) {
      toast({ title: "Drive sync disabled", description: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE });
      return;
    }
    try {
      const firebaseUser = await getDriveApiUser();
      if (companyId) markDriveOAuthReturnGrace(companyId);
      const { url } = await getGoogleDriveAuthUrl({
        returnPath: resolveDriveOAuthReturnPath(returnPath),
        uid: firebaseUser.uid,
        email: firebaseUser.email ?? undefined,
        formData: companyId ? { companyId } : undefined,
      });
      await openGoogleDriveOAuthUrl(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: "destructive",
        title: isLocalSyntheticAuthUid(user?.uid) ? "Google sign-in required" : "Drive connect failed",
        description: msg,
      });
    }
  };

  const handleJoin = async (invite: DriveSharedCompanyInvite) => {
    if (driveSyncDisabled) return;
    setJoiningId(invite.companyId);
    try {
      const rowPassword = passwordByFolderId[invite.driveFolderId]?.trim() || undefined;
      const joinedCompanyId = await joinDriveSharedLocalCompany(invite, {
        companyPassword: rowPassword,
      });
      markSuppressFirestorePermissionForCompany(joinedCompanyId);
      reloadLocalCompanyRegistry();
      await refreshLocalJoinState();
      await loadInvites();
      toast({
        title: "Company joined",
        description: `${invite.companyName} ledger loaded. Files are syncing in the background.`,
      });
      setPasswordByFolderId((prev) => {
        const next = { ...prev };
        delete next[invite.driveFolderId];
        return next;
      });
      onJoined?.(joinedCompanyId, "join");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: "destructive",
        title: "Join failed",
        description:
          msg === CLOUD_SYNC_DRIVE_SALT_MISSING_MSG
            ? msg
            : isCloudSyncEncryptionKeyRequiredError(msg)
              ? msg
              : msg,
      });
    } finally {
      setJoiningId(null);
    }
  };

  const handleResync = async (invite: DriveSharedCompanyInvite) => {
    if (driveSyncDisabled) return;
    setJoiningId(invite.companyId);
    try {
      const rowPassword = passwordByFolderId[invite.driveFolderId]?.trim() || undefined;
      const syncedCompanyId = await resyncDriveLocalCompanyFromInvite(invite, {
        companyPassword: rowPassword,
      });
      markSuppressFirestorePermissionForCompany(syncedCompanyId);
      reloadLocalCompanyRegistry();
      await refreshLocalJoinState();
      await loadInvites();
      toast({
        title: "Synced from Drive",
        description: `${invite.companyName} ledger loaded. Files are syncing in the background.`,
      });
      onJoined?.(syncedCompanyId, "resync");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: "destructive",
        title: "Sync from Drive failed",
        description:
          msg === CLOUD_SYNC_DRIVE_SALT_MISSING_MSG
            ? msg
            : isCloudSyncEncryptionKeyRequiredError(msg)
              ? msg
              : msg,
      });
    } finally {
      setJoiningId(null);
    }
  };

  const handleSelectConnected = async (inv: DriveSharedCompanyInvite) => {
    if (driveSyncDisabled) return;
    setJoiningId(inv.companyId);
    try {
      const companyId = await preloadDriveSharedCompanyLoginFromInvite(inv);
      markSuppressFirestorePermissionForCompany(companyId);
      reloadLocalCompanyRegistry();
      await refreshLocalJoinState();
      onJoined?.(companyId, "select");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: "destructive",
        title: "Could not open company",
        description: msg,
      });
    } finally {
      setJoiningId(null);
    }
  };

  /** Company naam | password (beech) | Restore/Join — har row alag encrypt password. */
  const renderInviteRow = (inv: DriveSharedCompanyInvite, actionLabel: "Restore" | "Join") => {
    const joinedLocal = findJoinedLocalCompanyForDriveInvite(inv, localRegistryRows);
    const alreadyJoined = joinedLocal != null;
    const joinedLocalId = joinedLocal?.id ? String(joinedLocal.id).trim() : "";
    const rowPassword = passwordByFolderId[inv.driveFolderId] ?? "";
    const busy = joiningId === inv.companyId;
    return (
      <div
        key={inv.driveFolderId}
        className="flex flex-col gap-2 rounded-md border border-emerald-200/80 bg-white/70 p-3 sm:flex-row sm:items-center dark:border-emerald-900/45 dark:bg-emerald-950/25"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{inv.companyName}</p>
          <p className="text-xs text-muted-foreground truncate">{inv.folderName}</p>
        </div>
        {!alreadyJoined ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-[14rem]">
            <Label htmlFor={`join-pwd-${inv.driveFolderId}`} className="sr-only">
              {inv.companyName} password
            </Label>
            <Input
              id={`join-pwd-${inv.driveFolderId}`}
              type="password"
              autoComplete="current-password"
              placeholder="Password (if encrypted)"
              value={rowPassword}
              onChange={(e) =>
                setPasswordByFolderId((prev) => ({ ...prev, [inv.driveFolderId]: e.target.value }))
              }
              disabled={driveSyncDisabled}
              className="h-9"
            />
          </div>
        ) : inv.isOwnedOnDrive ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-[14rem]">
            <Label htmlFor={`join-pwd-${inv.driveFolderId}`} className="sr-only">
              {inv.companyName} password
            </Label>
            <Input
              id={`join-pwd-${inv.driveFolderId}`}
              type="password"
              autoComplete="current-password"
              placeholder="Password for Sync from Drive"
              value={rowPassword}
              onChange={(e) =>
                setPasswordByFolderId((prev) => ({ ...prev, [inv.driveFolderId]: e.target.value }))
              }
              disabled={driveSyncDisabled}
              className="h-9"
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 shrink-0 sm:self-center">
          {alreadyJoined && joinedLocalId ? (
            <Button
              type="button"
              size="sm"
              variant="default"
              className="rounded-full"
              disabled={busy || driveSyncDisabled}
              onClick={() => void handleSelectConnected(inv)}
            >
              Select
            </Button>
          ) : null}
          {alreadyJoined ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={busy || driveSyncDisabled}
              onClick={() => void handleResync(inv)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sync from Drive"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="default"
              className="rounded-full"
              disabled={busy || driveSyncDisabled}
              onClick={() => void handleJoin(inv)}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-1" />
                  {actionLabel}
                </>
              )}
            </Button>
          )}
          {alreadyJoined ? (
            <span className="text-xs font-medium text-primary px-2 py-1 rounded-full bg-primary/10">
              Connected
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className={cn(!embedded && cloudSyncJoinPanelCard, !embedded && "p-4", "h-full min-h-0 flex flex-col", className)}>
      {!embedded ? (
        <div className="flex items-center gap-2 shrink-0">
          <p className="flex items-center gap-2 text-base font-semibold text-emerald-900 dark:text-emerald-100">
            <Cloud className="h-4 w-4 shrink-0" />
            Join shared local company
          </p>
          <CloudSyncHelpPopover
            label="Join shared local company"
            description={
              <>
                <p>
                  Your own companies under My Drive → Pocket Ledger, plus folders others shared with your Gmail.
                </p>
                <p>Use the same Gmail as Firebase login.</p>
                <p>If empty after sync, Connect Google Drive again then Refresh list.</p>
              </>
            }
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full px-4"
          disabled={driveSyncDisabled}
          onClick={() => void connectDrive()}
        >
          Connect Google Drive
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-blue-300 bg-blue-50 px-4 text-blue-700 hover:bg-blue-100 hover:text-blue-800 disabled:opacity-60 dark:border-blue-800 dark:bg-blue-950/35 dark:text-blue-200 dark:hover:bg-blue-900/45"
          disabled={loading || driveSyncDisabled}
          onClick={() => void loadInvites()}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh list"}
        </Button>
      </div>

      {driveSyncDisabled ? (
        <p className="text-sm font-medium text-amber-900 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
          {LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE}
        </p>
      ) : null}

      {visibleError ? (
        <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-3">
          {visibleError.includes("not connected") || visibleError.includes("Sign in")
            ? `${visibleError} — use Connect Google Drive first.`
            : visibleError}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !invitesEverLoaded ? (
        <p className="text-sm text-muted-foreground py-2">
          Click <strong>Refresh list</strong> to search Google Drive for shared Pocket Ledger companies.
        </p>
      ) : !hasAnyInvites ? (
        <p className="text-sm text-muted-foreground py-2">
          No Pocket Ledger company folders found on Drive. Sync a local company first (Enable cloud sync → Force sync),
          or ask the owner to share their folder with your Gmail. Then Connect Google Drive and Refresh list.
        </p>
      ) : (
        <div className="space-y-4">
          {ownedInvites.length > 0 ? (
            <Card className={cloudSyncNestedCard}>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5">
                  My companies on Drive
                  <CloudSyncHelpPopover
                    label="My companies on Drive"
                    description={
                      <div className="space-y-2 text-sm">
                        <p>
                          Encrypt ON ho to har company ka apna Company Profile password — usi row me likho, phir
                          Restore.
                        </p>
                        <p>
                          Google Drive se folder hard-delete hone par yahan list me nahi dikhega. Drive sync ON hai aur
                          folder Drive par nahi mila to device se local company bhi hatt jati hai. Sync OFF hai to local
                          company device par rehti hai — sirf yahan card se hat jati hai.
                        </p>
                        <p>Local delete ke liye company settings me Danger zone use karein.</p>
                      </div>
                    }
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4 pt-0">
                {ownedInvites.map((inv) => renderInviteRow(inv, "Restore"))}
              </CardContent>
            </Card>
          ) : null}
          {groupedBySharer.map(([email, rows]) => (
            <Card key={email} className={cloudSyncNestedCard}>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium text-emerald-900 dark:text-emerald-100 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span>
                    Shared with me · {rows[0]?.sharedByName ? `${rows[0].sharedByName} · ` : ""}
                    {email}
                  </span>
                  <CloudSyncHelpPopover
                    label="Shared with me"
                    description={
                      <p>Owner ne encrypt ON kiya ho to us company ka password middle field me — phir Join.</p>
                    }
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4 pt-0">
                {rows.map((inv) => renderInviteRow(inv, "Join"))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
