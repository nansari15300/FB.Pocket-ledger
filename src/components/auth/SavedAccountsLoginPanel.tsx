"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Mail, Trash2, UserPlus, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { pocketBaseGoogleSignIn, pocketBaseSignIn, pocketBaseSignOut } from "@/lib/pocketbaseData/pbClient";
import { pocketBaseSessionUid, readPocketBaseAppProfile, startPocketBaseAppSession } from "@/lib/pocketbaseData/pbAppSession";
import { resolvePostAuthCompanyRoute } from "@/lib/postAuthCompanyRoute";
import { isFeatureEnabled } from "@/config/plans";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import {
  decryptSavedLoginPassword,
  listSavedLoginAccounts,
  removeSavedLoginAccount,
  type SavedLoginAccountRecord,
} from "@/lib/savedLoginAccounts";

type Props = {
  onBack: () => void;
};

/** APK/EXE login: saved accounts list — tap se bina email/password field ke sign-in. */
export function SavedAccountsLoginPanel({ onBack }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const livePlans = useLivePlans();
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [busyOther, setBusyOther] = useState(false);
  const [rows, setRows] = useState(() => listSavedLoginAccounts());

  const entitledRows = useMemo(
    () =>
      rows.filter((row) => {
        const plan = getPlanFromPlans(livePlans, row.planIdAtSave);
        return isFeatureEnabled(plan.id, "savedAccountSwitchEnabled");
      }),
    [rows, livePlans]
  );

  /** After a Pocket Ledger Server sign-in: open the session and load the app fresh (server data only). */
  const finishServerLogin = useCallback(async () => {
    try {
      await auth.signOut();
    } catch {
      /* no Firebase session */
    }
    try {
      await startPocketBaseAppSession();
    } catch (e) {
      pocketBaseSignOut();
      throw e;
    }
    const p = readPocketBaseAppProfile();
    window.location.assign(resolvePostAuthCompanyRoute(p ? pocketBaseSessionUid(p) : undefined, p?.email ?? undefined));
  }, []);

  const switchTo = async (record: SavedLoginAccountRecord) => {
    setBusyUid(record.uid);
    try {
      if (record.authMethod === "password") {
        const password = await decryptSavedLoginPassword(record);
        if (!password) {
          toast({
            variant: "destructive",
            title: "Could not unlock saved account",
            description: "Saved password missing or corrupted. Remove and sign in normally.",
          });
          return;
        }
        await pocketBaseSignIn(record.email, password);
        await finishServerLogin();
        return;
      }
      await pocketBaseGoogleSignIn();
      await finishServerLogin();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sign-in failed.";
      toast({ variant: "destructive", title: "Could not switch account", description: msg });
    } finally {
      setBusyUid(null);
    }
  };

  const signInWithAnotherGoogleAccount = async () => {
    setBusyOther(true);
    try {
      await pocketBaseGoogleSignIn();
      await finishServerLogin();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sign-in failed.";
      toast({ variant: "destructive", title: "Google sign-in failed", description: msg });
    } finally {
      setBusyOther(false);
    }
  };

  const removeRow = (uid: string) => {
    removeSavedLoginAccount(uid);
    setRows(listSavedLoginAccounts());
  };

  const busy = busyUid != null || busyOther;

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Change account</h2>
        <p className="text-sm text-muted-foreground">
          Pick a saved account on this device, or sign in with a different one.
        </p>
      </div>

      {entitledRows.length > 0 ? (
        <ul className="space-y-2">
          {entitledRows.map((row) => {
            const label = row.displayName?.trim() || row.email;
            const rowBusy = busyUid === row.uid;
            return (
              <li key={row.uid} className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 justify-start h-auto py-3"
                  disabled={busy}
                  onClick={() => void switchTo(row)}
                >
                  <span className="mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    {rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="block truncate font-medium">{label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.email}</span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  aria-label={`Remove ${row.email}`}
                  onClick={() => removeRow(row.uid)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No saved accounts yet.</p>
      )}

      <div className="space-y-3">
        <div className="relative">
          <Separator />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
            or use another account
          </span>
        </div>
        <Button
          type="button"
          variant="default"
          className="w-full"
          disabled={busy}
          onClick={() => void signInWithAnotherGoogleAccount()}
        >
          {busyOther ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="mr-2 h-4 w-4" />
          )}
          Choose another Google account
        </Button>
        <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={onBack}>
          <Mail className="mr-2 h-4 w-4" />
          Sign in with email &amp; password
        </Button>
      </div>

      <Button type="button" variant="link" className="w-full" disabled={busy} onClick={onBack}>
        Back to sign in
      </Button>
    </div>
  );
}

/** Login page par saved rows + plan entitlement check (client mount). */
export function hasSavedAccountsForLoginPanel(livePlans: ReturnType<typeof useLivePlans>): boolean {
  return listSavedLoginAccounts().some((row) => {
    const plan = getPlanFromPlans(livePlans, row.planIdAtSave);
    return isFeatureEnabled(plan.id, "savedAccountSwitchEnabled");
  });
}
