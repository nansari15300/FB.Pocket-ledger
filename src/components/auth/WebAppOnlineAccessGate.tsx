"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CloudOff, Download, Loader2, LogOut, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { clearPocketBaseAppSessionOnLogout } from "@/lib/plClientSession";
import { isPocketBaseSessionUser } from "@/lib/pocketbaseData/pbAppSession";
import { isServerOnlyLoginSession } from "@/lib/pocketbaseData/serverSessionCompanyScope";
import { webAppBasePath } from "@/lib/webAppBasePath";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { Button } from "@/components/ui/button";

const SESSION_ALLOW_KEY = "pl.webAppOnlineAccess.allowed";

/**
 * Hosted browser use is reserved for Firebase Online plan holders and users who
 * were invited to an online company. APK/EXE retain local-company access.
 */
export function WebAppOnlineAccessGate({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [checkNonce, setCheckNonce] = useState(0);
  const [denyDetail, setDenyDetail] = useState<string | null>(null);
  const allowedRef = useRef(false);

  const isEmbeddedApp = useMemo(
    () => isStaticAppBuild() || isCapacitorNativeApp() || isElectronDesktopApp(),
    []
  );
  // Billing must remain reachable so an ineligible browser account can upgrade.
  const billingRoute = pathname === "/billing" || Boolean(pathname?.startsWith("/billing/"));
  const userUid = user?.uid || "";
  const userEmail = user?.email || "";

  useEffect(() => {
    allowedRef.current = allowed;
  }, [allowed]);

  // Direct dashboard URLs must never show the plan/share denial screen before
  // authentication. `/` is the app's login page (under hosted `/app` too).
  useEffect(() => {
    if (isEmbeddedApp || billingRoute || authLoading || userUid) return;
    router.replace("/");
  }, [authLoading, billingRoute, isEmbeddedApp, router, userUid]);

  // Signed-out + auth resolved: SPA `router.replace` miss ho to turant hard redirect.
  useLayoutEffect(() => {
    if (isEmbeddedApp || billingRoute || authLoading || userUid) return;
    try {
      const inner = pathname?.replace(/\/+$/, "") || "/";
      if (inner === "/" || inner === "") return;
    } catch {
      /* ignore */
    }
    window.location.assign(`${webAppBasePath()}/`);
  }, [authLoading, billingRoute, isEmbeddedApp, pathname, userUid]);

  // Production hosted web: authLoading kabhi atak jaye ya hydrate slow ho — unsigned hard fallback.
  useEffect(() => {
    if (isEmbeddedApp || billingRoute || userUid) return;
    const loginHref = `${webAppBasePath()}/`;
    const timer = window.setTimeout(() => {
      if (userUid) return;
        try {
        const inner = pathname?.replace(/\/+$/, "") || "/";
        if (inner === "/" || inner === "") return;
      } catch {
        /* ignore */
      }
      window.location.assign(loginHref);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [billingRoute, isEmbeddedApp, pathname, userUid]);

  useEffect(() => {
    if (isEmbeddedApp || billingRoute) {
      setChecking(false);
      setAllowed(true);
      return;
    }
    if (authLoading) {
      setChecking(true);
      return;
    }
    if (!userUid) {
      setChecking(false);
      setAllowed(true);
      return;
    }

    let cancelled = false;
    // Keep prior allow while rechecking so Party / sidebar nav does not flash the deny screen.
    if (!allowedRef.current) {
      try {
        if (sessionStorage.getItem(SESSION_ALLOW_KEY) === userUid) {
          setAllowed(true);
          allowedRef.current = true;
        }
      } catch {
        /* ignore */
      }
      setChecking(true);
    }

    void (async () => {
      try {
        // Pocket Ledger Server login (pl_users): the account is created by the server admin,
        // and the server decides which companies it can open.
        // Also when a stale Firebase user is still being signed out on this page load: no
        // `/api/auth/web-access` (firebase-admin Firestore read) and no shared-company Firestore pull.
        if (isServerOnlyLoginSession() || isPocketBaseSessionUser(user)) {
          setAllowed(true);
          allowedRef.current = true;
          setDenyDetail(null);
          return;
        }
        // Pocket Ledger Server is the only login now: no server session = no access.
        if (!cancelled && !allowedRef.current) setAllowed(false);
      } catch {
        if (!cancelled && !allowedRef.current) setAllowed(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Stabilize on uid/email — useAuth often replaces the user object identity on profile merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user object identity is unstable
  }, [authLoading, billingRoute, checkNonce, isEmbeddedApp, userUid, userEmail]);

  const retry = useCallback(() => setCheckNonce((value) => value + 1), []);

  if (isEmbeddedApp || billingRoute) return <>{children}</>;

  if (!user) {
    const loginHref = `${webAppBasePath()}/`;
    return (
      <div
        data-pl-web-auth-gate="1"
        className="flex min-h-dvh items-center justify-center bg-background p-6"
      >
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {authLoading ? "Loading session…" : "Redirecting to sign in…"}
          </div>
          {!authLoading ? (
            <Button variant="link" className="h-auto px-0" asChild>
              <a href={loginHref}>Continue to sign in</a>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (checking && !allowed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking web access…
        </div>
      </div>
    );
  }

  if (allowed) return <>{children}</>;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/25 p-4">
      <section className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <CloudOff className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="truncate text-sm font-medium" title={user.email || undefined}>
              {user.email || "Current account"}
            </p>
          </div>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Web access is not available for this account</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your current plan does not include Online Company access, and no Online Company has been
          shared with this account. The Pocket Ledger web app is available only to users with an
          active Online Company plan or a shared Online Company invitation.
        </p>
        {denyDetail ? (
          <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">{denyDetail}</p>
        ) : null}
        <div className="mt-5 rounded-lg border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
          To continue with a local company, please download the Windows desktop app or Android app.
          To use the web app, upgrade to a plan that includes Online Company access, or ask your
          company administrator to share an Online Company with your account.
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <a href="/downloads/">
              <Download className="mr-2 h-4 w-4" />
              Download EXE or APK
            </a>
          </Button>
          <Button variant="outline" onClick={() => router.push("/billing")}>
            <TrendingUp className="mr-2 h-4 w-4" />
            View upgrade plans
          </Button>
          <Button variant="ghost" size="sm" onClick={retry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Check again
          </Button>
        </div>
        <Button
          variant="link"
          className="mt-5 h-auto px-0 text-muted-foreground"
          onClick={() => void clearPocketBaseAppSessionOnLogout()}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out and use another account
        </Button>
        <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Your existing local company data remains available in the desktop and mobile apps.
        </p>
      </section>
    </main>
  );
}
