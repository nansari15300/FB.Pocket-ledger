"use client";

/**
 * Select-company / header: offline company par "Add User" — Edit Company wala local API POST (same fields).
 * Drive share panel: local login + Gmail se Google Drive folder share.
 */
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { appendLocalCompanyUserClient, parseLocalCompanyUserRows, upsertUserInList } from "@/lib/localCompanyUsers";
import { getLocalCompanyById, upsertLocalCompany } from "@/lib/localCompanyStore";
import { isLocalOnlyMode } from "@/lib/localMode";
import type { Company } from "@/hooks/useCompany";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { getPlanFromPlans, useLivePlans } from "@/hooks/useLivePlans";
import { resolveEffectiveAccountPlanId } from "@/lib/accountPlanForOwner";
import {
  collectLocalBucketShareMemberEmails,
  formatShareUserCapMessage,
  resolveCompanyShareUserCap,
  wouldBlockNewShareInvite,
} from "@/lib/accountShareUserCap";
import { addDriveShareUserToLocalCompany } from "@/lib/localCloudSync/driveCloudSyncClient";
import { runLocalCloudSyncCycle } from "@/lib/localCloudSync/engine";
import { LOCAL_COMPANY_APP_ROLES, normalizeLocalCompanyAppRole } from "@/lib/localCompanyAppRoles";
import { LOCAL_SHARE_ROUTE_CONFLICT_MESSAGE } from "@/lib/localShareRouteGuards";
import {
  cloudSyncDialogContent,
  cloudSyncDialogOutlineButton,
  cloudSyncDialogPrimaryButton,
  cloudSyncDialogTitleClass,
} from "@/lib/companyProfileChrome";
import { cn } from "@/lib/utils";

type Props = {
  company: Company | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** SQLite/context list refresh after successful POST */
  onUserAdded?: () => void;
  /** Drive "Add Person" — Gmail share field + emerald dialog */
  variant?: "default" | "driveShare";
  companyName?: string;
};

export function AddLocalCompanyUserDialog({
  company,
  open,
  onOpenChange,
  onUserAdded,
  variant = "default",
  companyName,
}: Props) {
  const isDriveShare = variant === "driveShare";
  const { user } = useAuth();
  const { allCompanies, allCompaniesRegistry } = useCompany();
  const livePlans = useLivePlans();
  const [displayName, setDisplayName] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [shareGmail, setShareGmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("manager");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [loginUsernameTouched, setLoginUsernameTouched] = useState(false);
  const [routeConflictOpen, setRouteConflictOpen] = useState(false);
  const [routeConflictBusy, setRouteConflictBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setDisplayName("");
      setLoginUsername("");
      setShareGmail("");
      setPassword("");
      setRole("manager");
      setShowPw(false);
      setDisplayNameTouched(false);
      setLoginUsernameTouched(false);
      setRouteConflictOpen(false);
      setRouteConflictBusy(false);
    }
  }, [open]);

  const handleDriveGmailChange = (value: string) => {
    setShareGmail(value);
    if (!isDriveShare) return;
    const atIndex = value.indexOf("@");
    if (atIndex <= 0) return;
    const prefix = value.slice(0, atIndex).trim();
    if (!prefix) return;
    if (!displayNameTouched) setDisplayName(prefix);
    if (!loginUsernameTouched) setLoginUsername(prefix);
  };

  const saveDriveShare = async (options?: { changeMethodToDrive?: boolean }) => {
    if (!company?.id) return;
    const n = displayName.trim();
    const u = loginUsername.trim();
    const p = password.trim();
    const gmail = shareGmail.trim().toLowerCase();
    const appRole = normalizeLocalCompanyAppRole(role);
    await addDriveShareUserToLocalCompany({
      companyId: company.id,
      companyName: companyName ?? company.name,
      email: gmail,
      loginUsername: u,
      password: p,
      appRole,
      displayName: n,
      replaceExistingPlServerUser: options?.changeMethodToDrive === true,
    });
    void runLocalCloudSyncCycle(company.id, { force: true });
  };

  const handleSubmit = async () => {
    if (!company?.id) return;
    const n = displayName.trim();
    const u = loginUsername.trim();
    const p = password.trim();
    const gmail = shareGmail.trim().toLowerCase();
    const appRole = normalizeLocalCompanyAppRole(role);

    if (!n || !u || !p) {
      toast({
        variant: "destructive",
        title: "Details required",
        description: "Display name, login username, and password are required.",
      });
      return;
    }
    if (isDriveShare && (!gmail.includes("@") || !gmail.includes("."))) {
      toast({
        variant: "destructive",
        title: "Gmail required",
        description: "Enter a valid Gmail to share this company folder on Google Drive.",
      });
      return;
    }

    const ownerUid = String(company.ownerId || user?.uid || "").trim();
    if (ownerUid) {
      try {
        const ownerSnap = await getDoc(doc(firestore, "users", ownerUid));
        const ownerUserData = ownerSnap.exists()
          ? (ownerSnap.data() as Record<string, unknown>)
          : null;
        const planId = resolveEffectiveAccountPlanId(allCompanies, ownerUid, company.planId);
        const plan = getPlanFromPlans(livePlans, planId);
        const maxUsers = resolveCompanyShareUserCap(plan, company, ownerUserData);
        const registry = allCompaniesRegistry?.length ? allCompaniesRegistry : allCompanies;
        const memberEmails = collectLocalBucketShareMemberEmails({
          ownerEmail: company.ownerEmail,
          ownerUid,
          localRegistryRows: registry ?? [],
        });
        const inviteKey = (isDriveShare ? gmail : u).trim().toLowerCase();
        if (wouldBlockNewShareInvite({ memberEmails, inviteEmail: inviteKey, maxUsers })) {
          toast({
            variant: "destructive",
            title: "Plan limit reached",
            description: formatShareUserCapMessage(maxUsers),
          });
          return;
        }
      } catch {
        /* cap check optional — save still allowed if Firestore unavailable */
      }
    }

    setLoading(true);
    try {
      if (isDriveShare) {
        await saveDriveShare();
      } else if (isLocalOnlyMode()) {
        const doc = await getLocalCompanyById(company.id, { includeDeleted: true });
        const rows = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown })?.localCompanyUsers);
        const next = upsertUserInList(rows, {
          username: u,
          displayName: n,
          role: appRole,
          password: p,
        });
        await upsertLocalCompany({
          ...(doc as Record<string, unknown>),
          id: company.id,
          localCompanyUsers: next,
          updatedAt: Date.now(),
        } as unknown as Parameters<typeof upsertLocalCompany>[0]);
      } else {
        await appendLocalCompanyUserClient(company.id, {
          displayName: n,
          username: u,
          password: p,
          role: appRole,
        });
      }

      toast({
        title: isDriveShare ? "Person added & shared" : "User added",
        description: isDriveShare
          ? `${n} can log in; ${gmail} has Drive folder access.`
          : `${n} can log in with username "${u}".`,
      });
      onUserAdded?.();
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isDriveShare && (msg === LOCAL_SHARE_ROUTE_CONFLICT_MESSAGE || msg.includes("Username already exists"))) {
        setRouteConflictOpen(true);
        return;
      }
      toast({
        variant: "destructive",
        title: isDriveShare ? "Could not add or share" : "Could not add user",
        description: msg || "Try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const changeMethodToDrive = async () => {
    setRouteConflictBusy(true);
    try {
      await saveDriveShare({ changeMethodToDrive: true });
      toast({
        title: "Sharing method changed",
        description: `${shareGmail.trim().toLowerCase()} is now shared through Google Drive.`,
      });
      setRouteConflictOpen(false);
      onUserAdded?.();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not change method",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRouteConflictBusy(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(isDriveShare && cloudSyncDialogContent)}>
        <DialogHeader>
          <DialogTitle className={cn(isDriveShare && cloudSyncDialogTitleClass)}>
            {isDriveShare ? "Add person & share on Drive" : "Add company user"}
          </DialogTitle>
          <DialogDescription>
            {isDriveShare
              ? company?.name
                ? `Local login for "${company.name}" + Google Drive folder share by Gmail.`
                : "Add local login and share the company folder on Google Drive."
              : company?.name
                ? `Add a login for "${company.name}" on this device.`
                : "Add a local company login user."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {isDriveShare ? (
            <div className="space-y-1">
              <Label htmlFor="drive-share-gmail">Share on Google Drive (Gmail)</Label>
              <Input
                id="drive-share-gmail"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="staff@gmail.com"
                value={shareGmail}
                onChange={(e) => handleDriveGmailChange(e.target.value)}
              />
              <p className="text-xs text-emerald-800/80 dark:text-emerald-300/90">
                This Gmail gets Drive folder write access and can join from Settings &gt; Join shared local company.
              </p>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label>Display name</Label>
            <Input
              value={displayName}
              onChange={(e) => {
                setDisplayNameTouched(true);
                setDisplayName(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label>Login username</Label>
            <Input
              value={loginUsername}
              onChange={(e) => {
                setLoginUsernameTouched(true);
                setLoginUsername(e.target.value);
              }}
              autoComplete="username"
            />
          </div>
          <div className="space-y-1">
            <Label>Password</Label>
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setShowPw((v) => !v)}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            {isDriveShare ? (
              <Select value={appRoleSafe(role)} onValueChange={setRole}>
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
            ) : (
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="manager" />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className={cn(isDriveShare && cloudSyncDialogOutlineButton)}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className={cn(isDriveShare && cloudSyncDialogPrimaryButton)}
            onClick={() => void handleSubmit()}
            disabled={loading}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isDriveShare ? "Add & share" : "Add user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={routeConflictOpen} onOpenChange={setRouteConflictOpen}>
      <DialogContent className={cn(cloudSyncDialogContent, "sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle className={cloudSyncDialogTitleClass}>User already shared on PL Server</DialogTitle>
          <DialogDescription>
            This user is already shared through PL Server for this company. A user can be shared through either PL
            Server or Google Drive, but not both.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
          Change method to Drive will remove this user's PL Server share entry on this company, then add Google Drive
          sharing.
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className={cloudSyncDialogOutlineButton}
            disabled={routeConflictBusy}
            onClick={() => setRouteConflictOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className={cloudSyncDialogPrimaryButton}
            disabled={routeConflictBusy}
            onClick={() => void changeMethodToDrive()}
          >
            {routeConflictBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Change method to Drive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function appRoleSafe(role: string): string {
  return normalizeLocalCompanyAppRole(role);
}
