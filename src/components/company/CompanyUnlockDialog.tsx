"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import type { Company as CompanyData } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { CompanyUnlockContextPickers } from "@/components/company/CompanyUnlockContextPickers";
import { RememberCompanyPasswordDurationSelect } from "@/components/company/RememberCompanyPasswordDurationSelect";
import {
  grantOpenLocalCompanySession,
  isOfflineCompanyStorage,
  isOnlineSharedCompany,
  onlineSharedHasPerUserPassword,
  showCompanyUserNameField,
  verifyCompanyUnlockAsync,
} from "@/lib/companyUnlockGate";
import {
  saveRememberedSharedUnlockUsername,
  clearRememberedSharedUnlockUsername,
} from "@/lib/onlineSharedUnlockRememberUsername";
import { localAuthLoginForCompanyContext } from "@/lib/localCompanyUsers";
import { setLocalAuthToken } from "@/lib/localApiClient";
import { saveOfflineUnlockSession } from "@/lib/offlineCompanyUnlockRemember";
import { saveCloudCompanyPasswordUnlockSession } from "@/lib/cloudCompanyPasswordUnlockRemember";
import { scheduleLocalCloudSyncInBackground } from "@/lib/localCloudSync/engine";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { isServerGateCompany, partitionCompaniesForUnlockDialog, type CompanyListTab } from "@/lib/companyStorageKind";
import { pickCompanyForUnlockTab, resolveCompanyUnlockTab, unlockTabCompanies } from "@/lib/companySelectorGateLabel";
import type { GateRecord } from "@/lib/gates/gateTypes";
import { appNavHref } from "@/lib/appNavHref";
import {
  activateGateForServerCompanyIfNeeded,
  canRememberCompanyUsername,
  finalizePlServerGateCompanyOpen,
  primeCompanyUnlockDialogFields,
  rememberUnlockDaysForCompany,
  unlockServerGateCompanyWithCredentials,
} from "@/lib/companyUnlockDialogFlow";

function handleRememberUsernameCheckboxChange(
  checked: boolean,
  setRemember: (v: boolean) => void
): void {
  setRemember(checked);
}

export function CompanyUnlockDialog({
  company,
  companies,
  preferredGate,
  pinCompanyId,
  onOpenChange,
  onUnlocked,
  reloadLocalCompanyRegistry,
}: {
  company: CompanyData | null;
  companies: CompanyData[];
  preferredGate?: GateRecord | null;
  /** Gate list se khuli company — picker auto-switch band. */
  pinCompanyId?: string | null;
  onOpenChange: (open: boolean) => void;
  /** Default: navigate dashboard + toast. Gate page custom routing ke liye override karo. */
  onUnlocked?: (companyId: string, companyName: string) => void | Promise<void>;
  reloadLocalCompanyRegistry?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { setCompanyId } = useCompany();
  const open = company != null;

  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUnlockDays, setRememberUnlockDays] = useState(0);
  const [rememberSharedUsername, setRememberSharedUsername] = useState(false);
  const [unlockListTab, setUnlockListTab] = useState<CompanyListTab>("local");
  const unlockTabPinnedRef = useRef(false);
  const unlockDialogCompanyIdRef = useRef<string | null>(null);
  const [activeCompany, setActiveCompany] = useState<CompanyData | null>(company);

  useEffect(() => {
    setActiveCompany(company);
  }, [company]);

  const unlockPickerCompanies = useMemo(() => {
    let list = companies.length > 0 ? [...companies] : activeCompany ? [activeCompany] : [];
    if (activeCompany && !list.some((c) => c.id === activeCompany.id)) {
      list = [...list, activeCompany];
    }
    const pinned = String(pinCompanyId || activeCompany?.id || "").trim();
    if (pinned && preferredGate?.type === "local_server") {
      list = list.map((row) =>
        row.id === pinned
          ? ({
              ...row,
              plServerShared: true,
              plServerGateId: preferredGate.id,
              plServerGateServerUrl: preferredGate.serverUrl,
            } as CompanyData)
          : row
      );
    }
    return list;
  }, [companies, activeCompany, pinCompanyId, preferredGate]);

  useEffect(() => {
    if (!activeCompany) {
      unlockTabPinnedRef.current = false;
      unlockDialogCompanyIdRef.current = null;
      return;
    }
    const openId = activeCompany.id;
    if (unlockDialogCompanyIdRef.current !== openId) {
      unlockDialogCompanyIdRef.current = openId;
      unlockTabPinnedRef.current = false;
    }
    if (unlockTabPinnedRef.current) return;
    const unlockBuckets = partitionCompaniesForUnlockDialog(unlockPickerCompanies);
    setUnlockListTab(resolveCompanyUnlockTab(activeCompany, unlockBuckets));
  }, [activeCompany?.id, unlockPickerCompanies, activeCompany]);

  useEffect(() => {
    if (!activeCompany) return;
    activateGateForServerCompanyIfNeeded(activeCompany);
    setRememberUnlockDays(rememberUnlockDaysForCompany(activeCompany, user?.uid, user?.email));
    primeCompanyUnlockDialogFields(
      activeCompany,
      { uid: user?.uid, email: user?.email },
      setUsernameInput,
      setRememberSharedUsername,
      { gate: preferredGate ?? undefined }
    );
  }, [activeCompany?.id, preferredGate?.id, user?.uid, user?.email, activeCompany, preferredGate]);

  const unlockTabHasSelectedCompany = useMemo(() => {
    if (!activeCompany) return false;
    const unlockBuckets = partitionCompaniesForUnlockDialog(unlockPickerCompanies);
    return unlockTabCompanies(unlockBuckets, unlockListTab).some((c) => c.id === activeCompany.id);
  }, [activeCompany, unlockPickerCompanies, unlockListTab]);

  const closeDialog = useCallback(() => {
    unlockTabPinnedRef.current = false;
    unlockDialogCompanyIdRef.current = null;
    onOpenChange(false);
    setUsernameInput("");
    setPasswordInput("");
    setRememberSharedUsername(false);
  }, [onOpenChange]);

  const switchUnlockDialogCompany = useCallback(
    (next: CompanyData, tab?: CompanyListTab) => {
      activateGateForServerCompanyIfNeeded(next);
      setActiveCompany(next);
      if (tab) {
        unlockTabPinnedRef.current = true;
        setUnlockListTab(tab);
      }
      setPasswordInput("");
      setRememberUnlockDays(rememberUnlockDaysForCompany(next, user?.uid, user?.email));
      primeCompanyUnlockDialogFields(
        next,
        { uid: user?.uid, email: user?.email },
        setUsernameInput,
        setRememberSharedUsername,
        { gate: preferredGate ?? undefined }
      );
    },
    [preferredGate, user?.email, user?.uid]
  );

  const handleUnlockTabChange = useCallback(
    (tab: CompanyListTab) => {
      unlockTabPinnedRef.current = true;
      const next = pickCompanyForUnlockTab(unlockPickerCompanies, tab, activeCompany?.id ?? null);
      if (!next) {
        setUnlockListTab(tab);
        return;
      }
      switchUnlockDialogCompany(next, tab);
    },
    [unlockPickerCompanies, activeCompany?.id, switchUnlockDialogCompany]
  );

  const handleUnlockCompanyChange = useCallback(
    (next: CompanyData) => {
      unlockTabPinnedRef.current = true;
      switchUnlockDialogCompany(next, unlockListTab);
    },
    [switchUnlockDialogCompany, unlockListTab]
  );

  const handlePasswordSubmit = async () => {
    if (!activeCompany) return;
    setIsVerifying(true);
    try {
      const row = activeCompany as CompanyData & { isOwned?: boolean };
      if (isOfflineCompanyStorage(row)) {
        const u = usernameInput.trim();
        const p = passwordInput.trim();
        if (!u || !p) {
          toast({
            variant: "destructive",
            title: "Company access",
            description: "Enter both login username and password.",
          });
          return;
        }
        if (isServerGateCompany(row)) {
          const openedId = activeCompany.id;
          const openedName = activeCompany.name;
          const rememberDays = rememberUnlockDays;
          let ledgerPullStarted = false;
          const unlocked = await unlockServerGateCompanyWithCredentials(
            row,
            u,
            p,
            rememberDays,
            {
              uid: user?.uid,
              email: user?.email,
            },
            {
              preferredGate,
              onLedgerPullStart: () => {
                ledgerPullStarted = true;
                closeDialog();
                setIsVerifying(false);
                grantOpenLocalCompanySession(openedId, { role: "manager" });
                activateGateForServerCompanyIfNeeded(row);
                setCompanyId(openedId);
                router.push(appNavHref("/dashboard"));
                toast({
                  title: "Loading company",
                  description: "Syncing masters & vouchers from server…",
                });
              },
            }
          );
          if (!unlocked.ok) {
            toast({
              variant: "destructive",
              title: ledgerPullStarted ? "Could not sync company" : "Could not open company",
              description: unlocked.error || "Sync failed.",
            });
            return;
          }
          await finalizePlServerGateCompanyOpen(openedId, row, {
            preferredGate,
            reloadLocalCompanyRegistry,
          });
          if (onUnlocked) {
            await onUnlocked(openedId, openedName);
            return;
          }
          toast({ title: "Access Granted", description: `Welcome to ${openedName}.` });
          return;
        }
        const { token, user: localUser } = await localAuthLoginForCompanyContext(activeCompany.id, u, p, {
          appUser: { uid: user?.uid, email: user?.email },
        });
        setLocalAuthToken(activeCompany.id, token, localUser);
        saveOfflineUnlockSession(user?.uid, activeCompany.id, rememberUnlockDays, token, localUser, user?.email);
        try {
          const reg = await getLocalCompanyById(activeCompany.id);
          if (reg && (reg as { cloudSyncEnabled?: boolean }).cloudSyncEnabled === true) {
            scheduleLocalCloudSyncInBackground(activeCompany.id, { force: true });
          }
        } catch {
          /* ignore */
        }
        toast({ title: "Access Granted", description: `Welcome to ${activeCompany.name}.` });
        closeDialog();
        if (onUnlocked) {
          await onUnlocked(activeCompany.id, activeCompany.name);
          return;
        }
        router.push("/dashboard");
        return;
      }

      const result = await verifyCompanyUnlockAsync(row, user?.email, usernameInput, passwordInput);
      if (result.ok) {
        if (!isOfflineCompanyStorage(row)) {
          saveCloudCompanyPasswordUnlockSession(user?.uid, activeCompany.id, rememberUnlockDays, user?.email);
        }
        if (canRememberCompanyUsername(activeCompany, user?.email)) {
          if (rememberSharedUsername) {
            saveRememberedSharedUnlockUsername(user?.uid, activeCompany.id, usernameInput.trim(), user?.email);
          } else {
            clearRememberedSharedUnlockUsername(user?.uid, activeCompany.id, user?.email);
          }
        }
        grantOpenLocalCompanySession(activeCompany.id, { role: "viewer" });
        toast({ title: "Access Granted", description: `Welcome to ${activeCompany.name}.` });
        const openedId = activeCompany.id;
        const openedName = activeCompany.name;
        closeDialog();
        if (onUnlocked) {
          await onUnlocked(openedId, openedName);
          return;
        }
        router.push("/dashboard");
        return;
      }
      toast({
        variant: "destructive",
        title: "Access Denied",
        description: ("message" in result && result.message) || "Invalid credentials.",
      });
      setPasswordInput("");
      return;
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Company access",
        description: e instanceof Error ? e.message : "Login failed.",
      });
      setPasswordInput("");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeDialog();
      }}
    >
      <AlertDialogContent className="flex max-h-[90dvh] w-[calc(100%-8px)] max-w-md flex-col gap-4 overflow-hidden rounded-2xl supports-[not(height:1dvh)]:max-h-[90vh]">
        <AlertDialogHeader className="shrink-0">
          <AlertDialogTitle>
            {activeCompany && isOfflineCompanyStorage(activeCompany)
              ? "Enter your credentials"
              : "Company access"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {activeCompany && isOfflineCompanyStorage(activeCompany) ? (
              <>Choose gate and company, then enter login username and password.</>
            ) : (
              <>
                Choose gate and company, then enter access details for{" "}
                <span className="font-medium text-foreground">&quot;{activeCompany?.name}&quot;</span>.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]">
          {activeCompany ? (
            <CompanyUnlockContextPickers
              companies={unlockPickerCompanies}
              company={activeCompany}
              unlockTab={unlockListTab}
              onUnlockTabChange={handleUnlockTabChange}
              onCompanyChange={handleUnlockCompanyChange}
              onOpenGatePage={closeDialog}
              pinCompanyId={pinCompanyId ?? activeCompany.id}
            />
          ) : null}
          <div className="space-y-3">
            {activeCompany && isOfflineCompanyStorage(activeCompany) ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="unlock-dialog-login-user">Login username</Label>
                  <Input
                    id="unlock-dialog-login-user"
                    autoComplete="username"
                    placeholder="e.g. sales_user"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handlePasswordSubmit()}
                    disabled={isVerifying}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="unlock-dialog-user-pw">Password</Label>
                  <div className="relative">
                    <Input
                      id="unlock-dialog-user-pw"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void handlePasswordSubmit()}
                      disabled={isVerifying}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={isVerifying}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <RememberCompanyPasswordDurationSelect
                  id="unlock-dialog-remember-days"
                  value={rememberUnlockDays}
                  onChange={setRememberUnlockDays}
                />
              </>
            ) : (
              <>
                {activeCompany && showCompanyUserNameField(activeCompany, user?.email) && (
                  <div className="space-y-1.5">
                    <Label htmlFor="unlock-dialog-username">Company username</Label>
                    <Input
                      id="unlock-dialog-username"
                      autoComplete="off"
                      name="pl-company-unlock-username"
                      placeholder={
                        isOnlineSharedCompany(activeCompany as CompanyData & { isOwned?: boolean }) &&
                        onlineSharedHasPerUserPassword(activeCompany as CompanyData & { isOwned?: boolean }, user?.email)
                          ? "Email, display name, or email prefix"
                          : "Company Profile → Admin username"
                      }
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void handlePasswordSubmit()}
                      disabled={isVerifying}
                    />
                    {canRememberCompanyUsername(activeCompany, user?.email) && (
                      <div className="flex items-center space-x-2 pt-1">
                        <Checkbox
                          id="unlock-dialog-remember-shared-username"
                          checked={rememberSharedUsername}
                          onCheckedChange={(v) =>
                            handleRememberUsernameCheckboxChange(
                              v === true,
                              setRememberSharedUsername
                            )
                          }
                        />
                        <Label htmlFor="unlock-dialog-remember-shared-username" className="text-sm font-normal cursor-pointer">
                          Remember username on this device
                        </Label>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="unlock-dialog-password">Company password</Label>
                  <div className="relative">
                    <Input
                      id="unlock-dialog-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void handlePasswordSubmit()}
                      disabled={isVerifying}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={isVerifying}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <RememberCompanyPasswordDurationSelect
                  id="unlock-dialog-cloud-remember-days"
                  value={rememberUnlockDays}
                  onChange={setRememberUnlockDays}
                />
              </>
            )}
          </div>
        </div>
        <AlertDialogFooter className="shrink-0 flex-row items-center gap-2 sm:justify-end [&>*]:mt-0">
          <AlertDialogCancel disabled={isVerifying} className="mt-0 flex-1 sm:flex-none">
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={isVerifying || !unlockTabHasSelectedCompany}
            onClick={() => void handlePasswordSubmit()}
            className="flex-1 sm:flex-none"
          >
            {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Unlock
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
