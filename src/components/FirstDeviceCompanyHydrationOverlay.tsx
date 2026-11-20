"use client";

/**
 * Pehli login / embedded company pick:
 * - Web: registry hydrate + min ~2s (purana behaviour).
 * - APK/static/EXE: account ki **saari** cloud-backed companies — SQLite mirror + attachment prefetch serial (`FirstLoginWarmGate` duplicate warm rokta hai).
 *   `OfflineWarmSyncManager` `gateActive` ke dauran debounced warm band.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import type { Company } from "@/hooks/useCompany";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  hasCompanyHydrationSplashBeenSeen,
  markCompanyHydrationSplashSeen,
} from "@/lib/deviceFirstCompanyHydrationSplash";
import { isEmbeddedOfflinePreloadClient } from "@/lib/isEmbeddedOfflinePreloadClient";
import {
  EMBEDDED_ACCOUNT_WARM_GAP_MS,
  orderCompaniesForAccountFullPreload,
  runEmbeddedCompanyFullPreload,
  sleepMs,
} from "@/lib/embeddedAccountOfflineWarm";
import {
  markEmbeddedFullWarmSucceeded,
  readEmbeddedFullWarmSucceeded,
} from "@/lib/embeddedWarmBootstrapFlags";
import { useFirstLoginWarmGate } from "@/contexts/FirstLoginWarmGateContext";
import {
  clearHeaderAttachmentPrefetchForCompany,
  reportHeaderAttachmentPrefetchProgress,
} from "@/contexts/EmbeddedAttachmentPrefetchContext";
import { runEmbeddedCompanyDeltaSync, shouldPrefetchAttachmentsForCompany } from "@/lib/offlineFullWarmSync";
import { isFirebaseLedgerLocalDeltaMode } from "@/lib/firebaseLedgerSyncMode";
import {
  clearEmbeddedPendingCompanyDataWarm,
  hasEmbeddedPendingCompanyDataWarm,
} from "@/lib/embeddedPendingCompanyWarm";
import { isEmbeddedDeviceLockGateBlocking } from "@/lib/embeddedDeviceLock";

const MIN_DISPLAY_MS = 2000;
/** Web-only: stuck trap */
const FORCE_DONE_MS = 18_000;

function milestonePercent(args: {
  authLoading: boolean;
  registryLoading: boolean;
  companyId: string | null;
  companyIdMatches: boolean;
}): number {
  if (args.authLoading) return 8;
  if (args.registryLoading) return 62;
  if (!args.companyId) return 94;
  if (args.companyIdMatches) return 100;
  return 82;
}

type CompanyProgress = { data: number; attach: number };

export function FirstDeviceCompanyHydrationOverlay() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { companyId, company, allCompanies, loading: registryLoading } = useCompany();
  const { setGateActive } = useFirstLoginWarmGate();

  const uid = user?.uid ?? "";
  const isLoginRoute = pathname === "/" || pathname === "";
  const isCompanySelectionRoute = pathname.startsWith("/company");
  /** APK / static build / Electron EXE — poora account offline preload. */
  const embeddedFullWarm = isFirebaseLedgerLocalDeltaMode() && isEmbeddedOfflinePreloadClient();

  const firstSplashPending =
    !!uid &&
    !hasCompanyHydrationSplashBeenSeen(uid) &&
    !authLoading &&
    !isLoginRoute &&
    !isCompanySelectionRoute;

  const pendingEmbeddedCompanyWarm =
    embeddedFullWarm &&
    !!uid &&
    !authLoading &&
    !isLoginRoute &&
    hasEmbeddedPendingCompanyDataWarm(uid, companyId) &&
    !!companyId &&
    company != null &&
    company.id === companyId &&
    shouldPrefetchAttachmentsForCompany(company);

  const deviceLockGateBlocking = isEmbeddedDeviceLockGateBlocking({
    authLoading,
    firebaseUid: uid,
  });

  const eligible =
    !deviceLockGateBlocking && (firstSplashPending || pendingEmbeddedCompanyWarm);

  const overlayClockStartRef = useRef<number | null>(null);
  const dismissedRef = useRef(false);
  const warmStartedRef = useRef(false);
  const warmAbortRef = useRef<AbortController | null>(null);
  const attachmentBgAbortRef = useRef<AbortController | null>(null);
  const prevCompanyIdForResetRef = useRef<string>("");

  const [displayPct, setDisplayPct] = useState(0);
  const [visible, setVisible] = useState(false);

  /** Serial company index — ek complete → agla auto */
  const [warmCompanyIndex, setWarmCompanyIndex] = useState(0);
  const [cloudRows, setCloudRows] = useState<Company[]>([]);
  const [progressById, setProgressById] = useState<Record<string, CompanyProgress>>({});
  const [warmPhase, setWarmPhase] = useState<"idle" | "running" | "done">("idle");

  const companyResolvedForSelection = useMemo(() => {
    if (!companyId?.trim()) return true;
    return company != null && company.id === companyId;
  }, [companyId, company]);

  const hydrationDone = !registryLoading && (!companyId || companyResolvedForSelection);

  const displayName =
    (company?.name && company.id === companyId ? company.name : null) ??
    allCompanies.find((c) => c.id === companyId)?.name ??
    "";

  const currentWarmCompany = cloudRows[warmCompanyIndex] ?? null;
  const currentDataPct = currentWarmCompany
    ? progressById[currentWarmCompany.id]?.data ?? 0
    : 0;
  const selectedCompanyDataPct = companyId
    ? progressById[companyId]?.data ?? 0
    : currentDataPct;

  /** Company switch: purana warm + background attachment cancel — nayi selection se overlap na ho. */
  useEffect(() => {
    if (!embeddedFullWarm) return;
    const next = (companyId || "").trim();
    const prev = prevCompanyIdForResetRef.current;
    if (next === prev) return;
    if (prev === "" && next) {
      prevCompanyIdForResetRef.current = next;
      return;
    }
    if (prev && next && prev !== next) {
      warmStartedRef.current = false;
      warmAbortRef.current?.abort();
      attachmentBgAbortRef.current?.abort();
      setWarmPhase("idle");
      setCloudRows([]);
      setProgressById({});
      dismissedRef.current = false;
    }
    prevCompanyIdForResetRef.current = next;
  }, [companyId, embeddedFullWarm]);

  useEffect(() => {
    if (eligible) {
      // APK/static: splash `startEmbeddedWarm` khud turant band karta hai — yahan `visible`/dismissed reset se race na ho.
      if (embeddedFullWarm) {
        return;
      }
      if (overlayClockStartRef.current == null) overlayClockStartRef.current = Date.now();
      setDisplayPct(0);
      dismissedRef.current = false;
      setVisible(true);
    } else {
      overlayClockStartRef.current = null;
      setVisible(false);
      dismissedRef.current = false;
    }
  }, [eligible]);

  /** Web: milestone cap creep (registry phase) */
  useEffect(() => {
    if (!visible || !eligible || embeddedFullWarm) return;
    const cap = milestonePercent({
      authLoading,
      registryLoading,
      companyId,
      companyIdMatches: companyResolvedForSelection,
    });
    const t = window.setInterval(() => {
      setDisplayPct((p) => {
        if (p >= cap) return Math.min(100, p);
        const gap = cap - p;
        const step = Math.max(0.85, Math.min(14, gap * 0.12 + Math.sin(Date.now() / 900) * 0.35));
        return Math.min(cap, Math.min(100, p + step));
      });
    }, 90);
    return () => window.clearInterval(t);
  }, [
    visible,
    eligible,
    embeddedFullWarm,
    authLoading,
    registryLoading,
    companyId,
    companyResolvedForSelection,
  ]);

  const skipToDashboard = useCallback(() => {
    warmAbortRef.current?.abort();
    attachmentBgAbortRef.current?.abort();
    warmStartedRef.current = false;
    if (companyId) clearEmbeddedPendingCompanyDataWarm(uid, companyId);
    dismissedRef.current = true;
    setDisplayPct(100);
    setVisible(false);
    setGateActive(false);
    if (!hasCompanyHydrationSplashBeenSeen(uid)) markCompanyHydrationSplashSeen(uid);
    router.replace("/dashboard");
  }, [companyId, router, setGateActive, uid]);

  /** APK/static/EXE: account ki saari cloud companies — selected pehle, phir baaki serial warm + attachments. */
  const startEmbeddedWarm = useCallback(async () => {
    if (!embeddedFullWarm || warmStartedRef.current || !uid) return;
    warmStartedRef.current = true;

    /** Hamesha account ki saari preload-eligible companies — offline files miss na hon. */
    const rows = orderCompaniesForAccountFullPreload(allCompanies ?? [], companyId);
    const accountWideFirstWarm = !readEmbeddedFullWarmSucceeded(uid);
    setCloudRows(rows);

    if (rows.length === 0) {
      setWarmPhase("done");
      setGateActive(false);
      if (!hasCompanyHydrationSplashBeenSeen(uid)) markCompanyHydrationSplashSeen(uid);
      if (companyId) clearEmbeddedPendingCompanyDataWarm(uid, companyId);
      setDisplayPct(100);
      window.setTimeout(() => setVisible(false), 280);
      return;
    }

    // UI turant SQLite mirror se — blocking splash hata; saari account companies background me.
    for (const r of rows) {
      clearEmbeddedPendingCompanyDataWarm(uid, r.id);
    }
    dismissedRef.current = true;
    setDisplayPct(100);
    setWarmPhase("running");
    setWarmCompanyIndex(0);
    if (!hasCompanyHydrationSplashBeenSeen(uid)) markCompanyHydrationSplashSeen(uid);
    setGateActive(false);
    setVisible(false);
    const doneProgress: Record<string, CompanyProgress> = {};
    for (const r of rows) {
      doneProgress[r.id] = { data: 100, attach: 0 };
    }
    setProgressById(doneProgress);

    // Offline→online / party-voucher par user ko mat hilaao — warm background me; pehle yahan `/dashboard` replace tha (poora app jump).

    void (async () => {
      setGateActive(true);
      const accountAc = new AbortController();
      warmAbortRef.current = accountAc;
      try {
        for (let i = 0; i < rows.length; i++) {
          if (accountAc.signal.aborted) break;
          setWarmCompanyIndex(i);
          const row = rows[i];
          const localId = String(row.id).trim();

          try {
            /* Pehli baar sirf full mirror; baad ke har start par delta — sirf unsynced (outbox) docs
             * server par jate hain, kuch pending nahi to koi download nahi. Isse "Server Data Syncing"
             * har refresh/company-open par poora data dobara load nahi karta. */
            if (accountWideFirstWarm) {
              await runEmbeddedCompanyFullPreload({
                company: row,
                localCompanyId: localId,
                signal: accountAc.signal,
                onAttachmentProgressPercent: (pct) =>
                  reportHeaderAttachmentPrefetchProgress(localId, pct),
              });
            } else {
              await runEmbeddedCompanyDeltaSync({
                company: row,
                localCompanyId: localId,
                signal: accountAc.signal,
              });
            }
          } catch {
            /* per-company network / abort */
          }

          setProgressById((prev) => ({
            ...prev,
            [row.id]: { data: 100, attach: 100 },
          }));

          if (i < rows.length - 1 && !accountAc.signal.aborted) {
            try {
              await sleepMs(EMBEDDED_ACCOUNT_WARM_GAP_MS, accountAc.signal);
            } catch {
              break;
            }
          }
        }
        if (!accountAc.signal.aborted && accountWideFirstWarm) {
          markEmbeddedFullWarmSucceeded(uid);
        }
      } finally {
        warmAbortRef.current = null;
        clearHeaderAttachmentPrefetchForCompany(companyId);
        setGateActive(false);
        setWarmPhase("done");
      }
    })();
  }, [
    embeddedFullWarm,
    uid,
    allCompanies,
    company,
    companyId,
    router,
    setGateActive,
  ]);

  useEffect(() => {
    if (!eligible || !embeddedFullWarm) return;
    if (!hydrationDone || warmPhase !== "idle") return;
    if (warmStartedRef.current) return;
    void startEmbeddedWarm();
  }, [eligible, embeddedFullWarm, hydrationDone, warmPhase, startEmbeddedWarm]);

  /** Web: min 2s + hydration — phir mark */
  useEffect(() => {
    if (!visible || !eligible || embeddedFullWarm) return;
    const iv = window.setInterval(() => {
      const start = overlayClockStartRef.current;
      if (start == null || dismissedRef.current) return;
      const elapsed = Date.now() - start;
      const canDismissByTime = elapsed >= MIN_DISPLAY_MS;
      const forceDismiss = elapsed >= FORCE_DONE_MS;
      const readyHydration = hydrationDone || forceDismiss;
      if (!readyHydration) return;
      if (!canDismissByTime && !forceDismiss) return;
      dismissedRef.current = true;
      setDisplayPct(100);
      markCompanyHydrationSplashSeen(uid);
      window.setTimeout(() => setVisible(false), 280);
    }, 140);
    return () => window.clearInterval(iv);
  }, [visible, eligible, embeddedFullWarm, hydrationDone, uid]);

  useEffect(() => {
    return () => {
      warmAbortRef.current?.abort();
      attachmentBgAbortRef.current?.abort();
      setGateActive(false);
    };
  }, [setGateActive]);

  /** Embedded running: overlay % = data mirror only (attachments header me). */
  useEffect(() => {
    if (!visible || !eligible || !embeddedFullWarm || warmPhase === "idle") return;
    setDisplayPct((p) => (selectedCompanyDataPct > p ? selectedCompanyDataPct : p));
  }, [visible, eligible, embeddedFullWarm, warmPhase, selectedCompanyDataPct]);

  if (!visible || !eligible) return null;

  const rounded = Math.min(100, Math.max(0, Math.round(displayPct)));

  return (
    <div
      className="fixed inset-0 z-[10050] flex flex-col items-center justify-center bg-background/92 p-6 backdrop-blur-md"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-border bg-card/95 p-8 shadow-lg">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/40">
          <img
            src="/app-icon.png"
            alt=""
            className="h-full w-full object-contain p-1"
            width={64}
            height={64}
          />
        </div>
        <div className="text-center space-y-1">
          <p className="text-lg font-semibold tracking-tight">
            {embeddedFullWarm ? "Loading your data for offline use" : "Loading your company"}
          </p>
          <p className="text-sm text-muted-foreground break-words min-h-[1.25rem]">
            {displayName ? (
              <span className="font-medium text-foreground">{displayName}</span>
            ) : companyId ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Preparing workspace…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Fetching companies…
              </span>
            )}
          </p>
        </div>

        {embeddedFullWarm && warmPhase === "running" && (
          <div className="w-full space-y-4 text-left">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Data (masters + vouchers)
                {currentWarmCompany?.name ? ` — ${currentWarmCompany.name}` : ""}
              </p>
              <Progress value={currentDataPct} className="h-2" />
              <p className="text-xs tabular-nums text-muted-foreground text-right">{currentDataPct}%</p>
            </div>
            <p className="text-[11px] text-center text-muted-foreground leading-snug">
              {cloudRows.length > 1
                ? `Downloading all ${cloudRows.length} companies in your account for offline use. Attachments cache after each company — progress appears under the header.`
                : "After this step, attachments cache in the background — a thin progress line appears under the app header while downloads run (online only)."}
            </p>
            <Button type="button" variant="outline" className="w-full" onClick={() => void skipToDashboard()}>
              Go to dashboard
            </Button>
            <p className="text-[10px] text-center text-muted-foreground">
              Skip stops this download — you can use the app; open vouchers online later to finish caching files.
            </p>
          </div>
        )}

        {(!embeddedFullWarm || warmPhase === "idle") && (
          <div className="w-full space-y-2">
            <Progress value={rounded} className="h-2.5" />
            <p className="text-center text-xs font-medium tabular-nums text-muted-foreground">{rounded}%</p>
          </div>
        )}
      </div>
    </div>
  );
}
