"use client";

import { useEffect, useRef } from "react";
import { auth } from "@/lib/plClientSession";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import {
  ELECTRON_FOREGROUND_RESUME_EVENT,
  ELECTRON_FOREGROUND_RESUME_MIN_HIDDEN_MS,
} from "@/lib/electronForegroundResume";
import { shouldSkipEmbeddedStartupAuthChurn, embeddedClientPrefersQuietBackgroundSync } from "@/lib/embeddedWarmBootstrapFlags";
import { flushVoucherOutbox } from "@/lib/localVoucherOutbox";
import { useCompany } from "@/hooks/useCompany";
import { nudgeElectronRendererUiWake } from "@/lib/electronUiWake";

/** APK/EXE + web local-first: resume par outbox flush; `online`/foreground par registry/token mat chhedo — reload/dashboard jump kam. */
export function StaticFastResumeSyncManager() {
  const { triggerSync, reloadLocalCompanyRegistry } = useCompany();
  const lastRunRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);
  /** Online/offline flap: defer timer cleanup; airplane par pehle `triggerSync()` turant listeners chhedta tha ("refresh" feel). */
  // Deferred reload timer id — browser number; TS `@types/node` conflicts Timeout vs number; `number` keeps next build happy with window.setTimeout.
  const deferredRegistryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isLocalOnlyMode()) return;

    let cancelled = false;
    let removeAppStateListener: (() => void) | undefined;

    const runBackgroundRefresh = (reason: string) => {
      const now = Date.now();
      const hiddenMs = hiddenAtRef.current != null ? now - hiddenAtRef.current : 0;
      const electronForegroundResume =
        isElectronDesktopApp() &&
        (reason === "electron-resume" ||
          reason === "focus" ||
          (reason === "visible" && hiddenMs >= ELECTRON_FOREGROUND_RESUME_MIN_HIDDEN_MS));
      // Standby se rapid duplicate events (visibility + Capacitor + online) aate hain; one small burst enough.
      const longIdleMs = 10 * 60 * 1000;
      const debounceMs = hiddenMs >= longIdleMs ? 0 : 2500;
      if (now - lastRunRef.current < debounceMs) return;
      lastRunRef.current = now;

      if (electronForegroundResume) {
        nudgeElectronRendererUiWake(reason);
      }

      window.setTimeout(() => {
        if (cancelled) return;
        const embeddedClient =
          isStaticAppBuild() || (typeof window !== "undefined" && isCapacitorNativeApp());
        const uid = auth.currentUser?.uid ?? null;

        /** Local-first: `online` / tab foreground par sirf outbox — har client (web + APK); `registryVersion` bump se listener rebuild + kabhi `/company`/`/dashboard` jump band. */
        const quietResumeNoRegistryTick =
          isLocalOnlyMode() &&
          (reason === "online" || reason === "visible" || reason === "appStateChange");

        /** Warm complete: purana behaviour — mount par bhi heavy tick mat. */
        const skipEmbeddedWarmMount =
          reason === "mount" &&
          isLocalOnlyMode() &&
          embeddedClient &&
          shouldSkipEmbeddedStartupAuthChurn(null, uid);

        /**
         * App already online + session: mount par `getIdToken` + `triggerSync` mat — user ko "auth dubara" / full UI refresh na lage.
         * Capacitor offline pehli open: `navigator.onLine` false → yahan skip nahi; registry tick se SQLite/Firestore align ho sakta hai.
         */
        const skipHeavyMountWhileOnlineSession =
          reason === "mount" &&
          isLocalOnlyMode() &&
          Boolean(uid) &&
          typeof navigator !== "undefined" &&
          navigator.onLine !== false;

        /** APK/EXE: resume/mount par registry tick se poori company/voucher listeners dubara bind — page "recover"/shake feel. */
        const embeddedQuietBackgroundOnly = embeddedClientPrefersQuietBackgroundSync();

        const skipRegistryAndToken =
          (quietResumeNoRegistryTick && !electronForegroundResume) ||
          skipEmbeddedWarmMount ||
          skipHeavyMountWhileOnlineSession ||
          (embeddedQuietBackgroundOnly && !electronForegroundResume);

        void flushVoucherOutbox();

        if (skipRegistryAndToken) {
          if (deferredRegistryTimerRef.current != null) {
            clearTimeout(deferredRegistryTimerRef.current);
            deferredRegistryTimerRef.current = null;
          }
          return;
        }

        void auth.currentUser?.getIdToken(false).catch(() => {
          // Offline startup: token fail ignore — next online `quiet` path bhi token force nahi karta.
        });

        // Sirf zarurat par: listener + deferred SQLite mirror bump.
        triggerSync();
        if (deferredRegistryTimerRef.current != null) {
          clearTimeout(deferredRegistryTimerRef.current);
          deferredRegistryTimerRef.current = null;
        }
        const delayMs = isCapacitorNativeApp() ? 4_000 : 2_500;
        deferredRegistryTimerRef.current = window.setTimeout(() => {
          deferredRegistryTimerRef.current = null;
          if (cancelled) return;
          reloadLocalCompanyRegistry();
        }, delayMs);
      }, 350);
    };

    const onOnline = () => runBackgroundRefresh("online");
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (document.visibilityState === "visible") {
        runBackgroundRefresh("visible");
        hiddenAtRef.current = null;
      }
    };
    const onFocus = () => {
      if (!isElectronDesktopApp()) return;
      const hiddenMs = hiddenAtRef.current != null ? Date.now() - hiddenAtRef.current : 0;
      if (hiddenMs < ELECTRON_FOREGROUND_RESUME_MIN_HIDDEN_MS) return;
      runBackgroundRefresh("focus");
    };
    const onElectronResume = () => runBackgroundRefresh("electron-resume");

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener(ELECTRON_FOREGROUND_RESUME_EVENT, onElectronResume);
    if (typeof navigator !== "undefined" && navigator.onLine) runBackgroundRefresh("mount");

    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) runBackgroundRefresh("appStateChange");
        })
      )
      .then((handle) => {
        removeAppStateListener = () => {
          void handle.remove();
        };
      })
      .catch(() => {
        // Desktop/web build me Capacitor plugin absent ho sakta hai; browser events enough hain.
      });

    return () => {
      cancelled = true;
      if (deferredRegistryTimerRef.current != null) {
        clearTimeout(deferredRegistryTimerRef.current);
        deferredRegistryTimerRef.current = null;
      }
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ELECTRON_FOREGROUND_RESUME_EVENT, onElectronResume);
      removeAppStateListener?.();
    };
  }, [reloadLocalCompanyRegistry, triggerSync]);

  return null;
}
