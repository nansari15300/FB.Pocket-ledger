"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PocketBaseFilesPanel } from "@/components/PocketBaseFilesStatus";
import {
  getPocketBaseServerUrl,
  getValidPocketBaseAuth,
  pocketBaseSignIn,
  pocketBaseSignOut,
  type PocketBaseAuthState,
} from "@/lib/pocketbaseData/pbClient";

/**
 * Sign-in to the Pocket Ledger Server (PocketBase app user, `pl_users`).
 * Only the session token is stored on the device; the password is never saved.
 */
export function PocketBaseSignInBox({ url }: { url?: string }) {
  const [auth, setAuth] = useState<PocketBaseAuthState | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAuth(getValidPocketBaseAuth());
  }, [url]);

  const serverUrl = url || getPocketBaseServerUrl();

  const signIn = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const a = await pocketBaseSignIn(email, password, serverUrl);
      setAuth(a);
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  if (auth) {
    return (
      <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl p-2 text-xs
        bg-white dark:bg-zinc-900
        border border-border/30
        shadow-[0_4px_16px_0_rgba(0,0,0,0.10),0_1px_4px_0_rgba(0,0,0,0.06)]
        dark:shadow-[0_4px_16px_0_rgba(0,0,0,0.40),0_1px_4px_0_rgba(0,0,0,0.25)]
        hover:shadow-[0_12px_32px_0_rgba(0,0,0,0.18),0_4px_12px_0_rgba(0,0,0,0.10)]
        dark:hover:shadow-[0_12px_32px_0_rgba(0,0,0,0.60),0_4px_12px_0_rgba(0,0,0,0.35)]
        hover:-translate-y-1
        transition-all duration-200 ease-out">
        <span className="text-muted-foreground">Pocket Ledger Server:</span>
        <span className="font-medium text-foreground" translate="no">
          {auth.email}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs"
          onClick={() => {
            pocketBaseSignOut();
            setAuth(null);
          }}
        >
          Sign out
        </Button>
      </div>
      <PocketBaseFilesPanel />
      </div>
    );
  }

  return (
    <form
      className="space-y-1.5 rounded-md border border-border bg-background p-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        void signIn();
      }}
    >
      <p className="text-muted-foreground">
        Sign in to the Pocket Ledger Server to sync its companies (
        <span className="font-mono" translate="no">
          {serverUrl}
        </span>
        ).
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          type="email"
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-7 min-w-[10rem] flex-1 text-xs"
          translate="no"
          disabled={busy}
        />
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-7 min-w-[8rem] flex-1 text-xs"
          disabled={busy}
        />
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={busy || !email.trim() || !password}>
          {busy ? "Signing in..." : "Sign in"}
        </Button>
      </div>
      {error ? <p className="text-destructive">{error}</p> : null}
    </form>
  );
}
