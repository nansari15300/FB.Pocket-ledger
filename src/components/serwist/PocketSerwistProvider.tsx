"use client";

/**
 * Registers `/sw.js` in production browsers + Capacitor remote WebView.
 * Dev me SW band — HMR/cache conflicts kam.
 * `next start` on localhost par bhi SW band: Serwist har Firebase Storage URL ko handle karke console flood + extra latency (400+ attachment rows).
 * **Electron EXE:** `cacheOnNavigation` = history `replaceState`/`pushState` patch + har navigation par SW `CACHE_URLS` — reports `router.replace` ke saath claim/refresh race; EXE par patch band, SW precache baaki clients jaisa.
 * Purana SW pehle se `controlling` ho to `disable` matlab "naya register mat" — purana intercept rukta nahi; `useEffect` se unregister.
 */
import { SerwistProvider } from "@serwist/next/react";
import type { ReactNode } from "react";
import { useEffect, useSyncExternalStore } from "react";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { publicAssetUrl } from "@/lib/webAppBasePath";

function isPocketLedgerSwCacheName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("serwist") ||
    lower.includes("workbox") ||
    lower.includes("precache") ||
    lower.includes("pl-navigate-shell")
  );
}

function useDisableSerwistForLocalBrowsing(): boolean {
  const disabledInDev = process.env.NODE_ENV === "development";
  /** EXE: packaged app me SW claim race (`InvalidStateError`) + React shell churn — offline shell zaroori nahi. */
  const disabledOnElectron = isElectronDesktopApp();
  const onLocalLoopback = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        const h = window.location.hostname;
        return h === "localhost" || h === "127.0.0.1";
      } catch {
        return false;
      }
    },
    () => false
  );
  return disabledInDev || onLocalLoopback || disabledOnElectron;
}

export function PocketSerwistProvider({ children }: { children: ReactNode }) {
  // Static export (packed `/app`, EXE, APK) never ships `sw.js` — Serwist is disabled at build.
  // Registering it on np.pocket-ledger.com 404s with no MIME type and floods the console.
  const disable = useDisableSerwistForLocalBrowsing() || isStaticAppBuild();
  /** EXE: navigation par history patch + SW message kam — real bug reports page duplicate `replace` tha, yeh extra guard. */
  const cacheOnNavigation = !isElectronDesktopApp();

  // Pehle install SW localhost / Electron par bhi intercept karta — disable=true par hata do.
  useEffect(() => {
    if (!disable || typeof window === "undefined") return;
    let cancelled = false;
    const cleanup = async () => {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (cancelled) return;
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const names = await window.caches.keys();
        if (cancelled) return;
        await Promise.all(names.filter(isPocketLedgerSwCacheName).map((name) => window.caches.delete(name)));
      }
    };
    void cleanup().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [disable]);

  return (
    <SerwistProvider
      swUrl={publicAssetUrl("/sw.js")}
      disable={disable}
      cacheOnNavigation={cacheOnNavigation}
      // Serwist default `reloadOnOnline=true` = har `online` par `location.reload()` — static/APK me offline→online + kabhi dashboard link par bhi "refresh" + SW `claim` race (InvalidStateError).
      reloadOnOnline={false}
    >
      {children}
    </SerwistProvider>
  );
}
