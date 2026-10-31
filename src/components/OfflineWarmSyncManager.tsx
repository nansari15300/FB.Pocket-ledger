"use client";

/**
 * Online + cloud-backed company hone par ek baar (debounced) full warm sync:
 * plans JSON, Firestore masters/vouchers SQLite mirror + attachment blob prefetch.
 * Company switch / visibility / `online` pe dubara queue — airplane mode offline UI ke liye.
 *
 * APK/static EXE: `allCompanies` me har cloud row ke liye serial warm — offline attachment preview tak.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Company } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import {
  shouldPrefetchAttachmentsForCompany,
} from "@/lib/offlineFullWarmSync";
import {
  EMBEDDED_FIRST_LOGIN_ATTACHMENT_PREFETCH,
  runEmbeddedCompanyFullPreload,
} from "@/lib/embeddedAccountOfflineWarm";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isEmbeddedOfflinePreloadClient } from "@/lib/isEmbeddedOfflinePreloadClient";
import { useFirstLoginWarmGate } from "@/contexts/FirstLoginWarmGateContext";
import { isLocalOnlyMode } from "@/lib/localMode";
import {
  clearHeaderAttachmentPrefetchForCompany,
  reportHeaderAttachmentPrefetchProgress,
} from "@/contexts/EmbeddedAttachmentPrefetchContext";

const WARM_DEBOUNCE_MS = 2_200;
/** EXE: dashboard paint ke turant baad selected/company attachment warm start ho, 90s baad nahi. */
const EMBEDDED_MULTI_WALK_START_MS_ELECTRON = 3_000;
/** Doosri company ka warm overlap na ho selected company ke debounced run se (`WARM_DEBOUNCE_MS` ke baad shuru). */
const EMBEDDED_MULTI_WALK_START_MS = 200;
/** Har company warm ke beech thoda gap — APK memory / bandwidth. */
const EMBEDDED_MULTI_GAP_MS = 750;
/** User se bina click: online rehne par periodic resweep se missed/failing attachments bhi dheere-dheere cache ho jayein. */
const EMBEDDED_MULTI_RESWEEP_MS = 8 * 60 * 1000;
/** EXE desktop: ledger detail scroll jump avoid — background resweep kam frequent. */
const EMBEDDED_MULTI_RESWEEP_MS_ELECTRON = 6 * 60 * 60 * 1000;
import { backgroundWarmSyncEnabled } from "@/lib/firebaseBillingOptimization";

const BACKGROUND_WARM_SYNC_ENABLED = backgroundWarmSyncEnabled();

export function OfflineWarmSyncManager() {
  const { user } = useAuth();
  const { companyId, company, loading, allCompanies } = useCompany();
  /** Pehli-login full-screen warm chal raha ho to yahan duplicate pull mat chalao */
  const { gateActive } = useFirstLoginWarmGate();

  /** Static APK / EXE / file: protocol — multi-company attachment + mirror queue */
  const embeddedMultiClient = isEmbeddedOfflinePreloadClient();
  // Embedded local-first: online event handlers se UI jump avoid; polling loop background me kaam kare.
  const suppressOnlineEventWarm = embeddedMultiClient && isLocalOnlyMode();

  /** Id set badalne par walker dubara queue — nayi shared company SQLite me aate hi prefetch. */
  const preloadCompanySig = useMemo(() => {
    const rows =
      allCompanies?.filter((c): c is Company => shouldPrefetchAttachmentsForCompany(c as Company)) ??
      [];
    return [...new Set(rows.map((c) => c.id).filter(Boolean))].sort().join(",");
  }, [allCompanies]);

  /** Mount/start offline hone par walker effect pehle return karta hai — `online` event se dubara queue. */
  const [embeddedOnlineWarmTick, bumpEmbeddedOnlineWarmTick] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (suppressOnlineEventWarm) return;
    const onOnline = () => bumpEmbeddedOnlineWarmTick((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [suppressOnlineEventWarm]);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const allCompaniesLatestRef = useRef(allCompanies);
  const companyIdLatestRef = useRef(companyId);
  const lastWarmCompletedAtRef = useRef(0);

  /** Serial multi-company walk — company list / abort lifecycle */
  const embeddedWalkAbortRef = useRef<AbortController | null>(null);
  const embeddedWalkTimerRef = useRef<number | null>(null);

  useEffect(() => {
    allCompaniesLatestRef.current = allCompanies;
  }, [allCompanies]);

  useEffect(() => {
    companyIdLatestRef.current = companyId;
  }, [companyId]);

  /** Shared schedule + cancel — multiple triggers same debounce funnel */
  const scheduleWarmFullSync = useCallback(() => {
    if (!BACKGROUND_WARM_SYNC_ENABLED) return;
    // Startup responsiveness mode: disable hidden background warm/API fan-out.
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (gateActive) return;
    if (!user || !navigator.onLine) return;
    if (loading || !companyId?.trim() || !company) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      runAbortRef.current?.abort();
      const c = new AbortController();
      runAbortRef.current = c;
      void runEmbeddedCompanyFullPreload({
        company,
        localCompanyId: companyId.trim(),
        signal: c.signal,
        prefetchOverrides: EMBEDDED_FIRST_LOGIN_ATTACHMENT_PREFETCH,
        onAttachmentProgressPercent: (pct) =>
          reportHeaderAttachmentPrefetchProgress(companyId.trim(), pct),
      }).finally(() => {
        if (!c.signal.aborted) lastWarmCompletedAtRef.current = Date.now();
        else clearHeaderAttachmentPrefetchForCompany(companyId);
      });
    }, WARM_DEBOUNCE_MS);
  }, [user, loading, companyId, company, gateActive]);

  useEffect(() => {
    if (!BACKGROUND_WARM_SYNC_ENABLED) return;
    // APK/EXE: serial multi-company walk already warm karta hai — company-switch debounced warm UI churn avoid.
    if (embeddedMultiClient) return;
    scheduleWarmFullSync();
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [scheduleWarmFullSync]);

  useEffect(() => {
    if (!BACKGROUND_WARM_SYNC_ENABLED) return;
    if (typeof window === "undefined") return;
    // APK/EXE: tab focus/online par selected-company warm mat — background walk + Firestore listeners kaafi.
    if (embeddedMultiClient) return;
    if (suppressOnlineEventWarm) return;
    const onOnline = () => scheduleWarmFullSync();
    const onVisibility = () => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      scheduleWarmFullSync();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [scheduleWarmFullSync, suppressOnlineEventWarm]);

  useEffect(() => {
    return () => {
      runAbortRef.current?.abort();
      clearHeaderAttachmentPrefetchForCompany(companyId);
    };
  }, [companyId]);

  // APK / static EXE: registry me jitni cloud-backed companies — ek ke baad ek warm (incremental attachments).
  useEffect(() => {
    if (!BACKGROUND_WARM_SYNC_ENABLED) return;
    embeddedWalkAbortRef.current?.abort();
    embeddedWalkAbortRef.current = null;
    if (embeddedWalkTimerRef.current != null) {
      window.clearTimeout(embeddedWalkTimerRef.current);
      embeddedWalkTimerRef.current = null;
    }

    if (gateActive) return;
    if (!embeddedMultiClient || !user || loading || !preloadCompanySig.trim()) return;
    if (typeof navigator === "undefined") return;

    const ac = new AbortController();
    embeddedWalkAbortRef.current = ac;

    const walkAllCloudCompaniesOnce = async () => {
      const snapshot = allCompaniesLatestRef.current;
      const rows =
        snapshot?.filter((c) => shouldPrefetchAttachmentsForCompany(c as Company | null)) ?? [];
      const prioritizeId = companyIdLatestRef.current?.trim() || null;
      // Selected company only: every other company sleeps (no background warm / prefetch).
      const ordered = prioritizeId ? rows.filter((c) => c.id === prioritizeId) : [];

      if (ordered.length === 0) return;
      try {
        for (let companyIndex = 0; companyIndex < ordered.length; companyIndex++) {
          const row = ordered[companyIndex]!;
          const rowId = String(row.id).trim();
          if (ac.signal.aborted || typeof navigator === "undefined" || !navigator.onLine) break;
          try {
            await runEmbeddedCompanyFullPreload({
              company: row,
              localCompanyId: rowId,
              signal: ac.signal,
              prefetchOverrides: EMBEDDED_FIRST_LOGIN_ATTACHMENT_PREFETCH,
              onAttachmentProgressPercent: (pct) =>
                reportHeaderAttachmentPrefetchProgress(rowId, pct),
            });
          } catch {
            /* per-row network failure: continue with next company */
          }
          await new Promise((r) => setTimeout(r, EMBEDDED_MULTI_GAP_MS));
        }
      } finally {
        clearHeaderAttachmentPrefetchForCompany(companyIdLatestRef.current);
      }
    };

    const scheduleNextPass = (delayMs: number) => {
      if (ac.signal.aborted) return;
      embeddedWalkTimerRef.current = window.setTimeout(() => {
        embeddedWalkTimerRef.current = null;
        void runPeriodicPassLoop();
      }, delayMs);
    };

    const runPeriodicPassLoop = async () => {
      if (ac.signal.aborted || typeof navigator === "undefined") return;
      if (
        isElectronDesktopApp() &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        scheduleNextPass(5 * 60 * 1000);
        return;
      }
      if (!navigator.onLine) {
        scheduleNextPass(30_000);
        return;
      }
      await walkAllCloudCompaniesOnce();
      if (!ac.signal.aborted) lastWarmCompletedAtRef.current = Date.now();
      const resweepMs = isElectronDesktopApp() ? EMBEDDED_MULTI_RESWEEP_MS_ELECTRON : EMBEDDED_MULTI_RESWEEP_MS;
      scheduleNextPass(resweepMs);
    };

    const walkStartMs = isElectronDesktopApp()
      ? EMBEDDED_MULTI_WALK_START_MS_ELECTRON
      : EMBEDDED_MULTI_WALK_START_MS;
    scheduleNextPass(walkStartMs);

    return () => {
      ac.abort();
      if (embeddedWalkTimerRef.current != null) {
        window.clearTimeout(embeddedWalkTimerRef.current);
        embeddedWalkTimerRef.current = null;
      }
    };
  }, [embeddedMultiClient, user, loading, preloadCompanySig, embeddedOnlineWarmTick, gateActive]);

  return null;
}
