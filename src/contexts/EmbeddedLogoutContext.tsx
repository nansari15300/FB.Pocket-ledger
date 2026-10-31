"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { User } from "@/lib/pbCompat/auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSavedAccountSwitchFeature } from "@/hooks/useSavedAccountSwitchFeature";
import { auth, signOutWithFirestoreTeardown } from "@/lib/firebase";
import { clearEmbeddedSessionUnlock } from "@/lib/embeddedDeviceLock";
import { disableLocalGuest, isLocalGuestEnabled } from "@/lib/localGuestSession";
import { pruneRememberedLoginEmailIfDisabled } from "@/lib/loginRememberEmail";
import { clearAllCloudCompanyPasswordUnlockSessionsForUser } from "@/lib/cloudCompanyPasswordUnlockRemember";
import { clearAllOfflineUnlockSessionsForUser } from "@/lib/offlineCompanyUnlockRemember";
import {
  detectSavedLoginAuthMethod,
  upsertSavedLoginAccount,
} from "@/lib/savedLoginAccounts";
import {
  peekSessionPasswordForSavedAccount,
  takeSessionPasswordForSavedAccount,
} from "@/lib/savedLoginSessionPassword";

type EmbeddedLogoutContextValue = {
  /** APK/EXE: plan on ho to save-account dialog; warna seedha logout. */
  requestEmbeddedLogout: () => void;
};

const EmbeddedLogoutContext = createContext<EmbeddedLogoutContextValue>({
  requestEmbeddedLogout: () => {},
});

export function useEmbeddedLogout() {
  return useContext(EmbeddedLogoutContext);
}

async function performFirebaseLogout(
  router: { replace: (path: string) => void },
  firebaseUid?: string | null,
  userEmail?: string | null
) {
  const { clearNavigationMemory } = await import("@/lib/navigation-memory");
  clearNavigationMemory();
  clearEmbeddedSessionUnlock();
  clearAllCloudCompanyPasswordUnlockSessionsForUser(firebaseUid ?? undefined, userEmail);
  clearAllOfflineUnlockSessionsForUser(firebaseUid ?? undefined);
  pruneRememberedLoginEmailIfDisabled();
  if (isLocalGuestEnabled()) {
    disableLocalGuest();
    router.replace("/");
    return;
  }
  await signOutWithFirestoreTeardown(auth);
  router.replace("/");
}

/** Logout par save-account prompt — DesktopAppHeader / sidebar / layout sab yahi call karte hain. */
export function EmbeddedLogoutProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const { enabled, accountPlanId } = useSavedAccountSwitchFeature();
  const [open, setOpen] = useState(false);
  const [saveAccount, setSaveAccount] = useState(true);
  const [passwordForSave, setPasswordForSave] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingUserRef = useRef<User | null>(null);

  const activeUser = pendingUserRef.current ?? user;
  // Local/synthetic user me `providerData` undefined ho sakta hai — `.map` crash na ho.
  const providerIds = activeUser?.providerData?.map((p) => p.providerId) ?? [];
  const authMethod = activeUser ? detectSavedLoginAuthMethod(providerIds) : ("password" as const);
  const activeEmail = activeUser?.email ?? "";
  const needsPasswordPrompt =
    saveAccount && authMethod === "password" && !peekSessionPasswordForSavedAccount(activeEmail);

  const finishLogout = useCallback(async () => {
    setBusy(true);
    try {
      const u = pendingUserRef.current ?? user;
      if (saveAccount && enabled && u?.email && u.uid) {
        const sessionPw = takeSessionPasswordForSavedAccount(u.email);
        const pw = sessionPw ?? passwordForSave.trim();
        if (authMethod === "password" && !pw) {
          // Password missing — skip save, still logout
        } else {
          await upsertSavedLoginAccount({
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            authMethod,
            password: authMethod === "password" ? pw : null,
            planIdAtSave: accountPlanId,
          });
        }
      }
      pendingUserRef.current = null;
      setOpen(false);
      setPasswordForSave("");
      await performFirebaseLogout(router, u?.uid, u?.email);
    } finally {
      setBusy(false);
    }
  }, [saveAccount, enabled, user, passwordForSave, authMethod, accountPlanId, router]);

  const requestEmbeddedLogout = useCallback(() => {
    if (!user || !enabled) {
      void performFirebaseLogout(router, user?.uid, user?.email);
      return;
    }
    pendingUserRef.current = user;
    setSaveAccount(true);
    setPasswordForSave("");
    setOpen(true);
  }, [user, enabled, router]);

  return (
    <EmbeddedLogoutContext.Provider value={{ requestEmbeddedLogout }}>
      {children}
      <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>
              Save this account on this device for quick switch from the login screen (no password next time).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={saveAccount}
              onChange={(e) => setSaveAccount(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded border-input"
            />
            Save account for quick switch
          </label>
          {saveAccount && authMethod === "password" && needsPasswordPrompt ? (
            <div className="space-y-2">
              <Label htmlFor="pl-logout-save-pw">Your password (stored encrypted on this device only)</Label>
              <Input
                id="pl-logout-save-pw"
                type="password"
                autoComplete="current-password"
                value={passwordForSave}
                onChange={(e) => setPasswordForSave(e.target.value)}
                disabled={busy}
              />
            </div>
          ) : null}
          {saveAccount && authMethod === "google" ? (
            <p className="text-xs text-muted-foreground">
              Google account will open with one-tap Google sign-in when you switch back.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || (saveAccount && authMethod === "password" && needsPasswordPrompt && passwordForSave.trim().length < 6)}
              onClick={(e) => {
                e.preventDefault();
                void finishLogout();
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EmbeddedLogoutContext.Provider>
  );
}
