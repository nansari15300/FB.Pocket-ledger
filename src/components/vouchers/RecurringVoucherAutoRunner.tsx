"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import usePermissions from "@/hooks/usePermissions";
import { useLocationSearchParams } from "@/hooks/useLocationSearchParams";
import { adToBs } from "@/lib/bs-date";
import {
  AUTO_RECURRING_SYNC_NOT_READY,
  generateDueRecurringVouchersOnAppOpen,
  recurringAutoRunnerSkipsCloudIO,
} from "@/lib/recurringVouchers";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import type { Company } from "@/hooks/useCompany";

const RUNNER_SESSION_KEY_PREFIX = "pl-recurring-runner";
const APP_OPEN_RUNNER_DELAY_MS = 2500;
/** PL Server company: sync not ready yet (offline / pull running) — retry later instead of using stale local data. */
const SYNC_NOT_READY_RETRY_MS = 60_000;
const SYNC_NOT_READY_MAX_RETRIES = 5;

function scheduleAfterFirstUiPaint(run: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let timeoutId: number | null = null;
  let idleId: number | null = null;
  const ric = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;
  const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;

  const start = () => {
    if (cancelled) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        if (typeof ric === "function") {
          idleId = ric(() => {
            if (!cancelled) run();
          }, { timeout: APP_OPEN_RUNNER_DELAY_MS });
          return;
        }
        timeoutId = window.setTimeout(() => {
          if (!cancelled) run();
        }, APP_OPEN_RUNNER_DELAY_MS);
      });
    });
  };

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });

  return () => {
    cancelled = true;
    window.removeEventListener("load", start);
    if (timeoutId != null) window.clearTimeout(timeoutId);
    if (idleId != null && typeof cic === "function") cic(idleId);
  };
}

export function RecurringVoucherAutoRunner() {
  const { companyId, company } = useCompany();
  const { user } = useAuth();
  const { can } = usePermissions();
  const pathname = usePathname();
  const searchParams = useLocationSearchParams();
  const inFlightRef = useRef(false);
  const cancelScheduledStartRef = useRef<(() => void) | null>(null);
  const companyRef = useRef<Company | null>(company);
  const fallbackCompanyRef = useRef<Company | null>(null);
  const canRef = useRef(can);
  const scheduledForKeyRef = useRef<string | null>(null);
  /** Bumps once when SQLite fallback company arrives — avoids depending on full `company` object identity. */
  const [fallbackReadyEpoch, setFallbackReadyEpoch] = useState(0);
  /** Bumps when a PL Server sync-not-ready run should be retried. */
  const [syncRetryEpoch, setSyncRetryEpoch] = useState(0);
  const syncRetryCountRef = useRef(0);
  const hasCompany = Boolean(company);

  companyRef.current = company;
  canRef.current = can;

  useEffect(() => {
    let cancelled = false;
    const cid = String(companyId || "").trim();
    if (!cid || hasCompany) {
      fallbackCompanyRef.current = null;
      return;
    }
    void getLocalCompanyById(cid, { includeDeleted: true })
      .then((row) => {
        if (cancelled || !row) return;
        fallbackCompanyRef.current = row as unknown as Company;
        setFallbackReadyEpoch((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [companyId, hasCompany]);

  useEffect(() => {
    const cid = String(companyId || "").trim();
    const uid = String(user?.uid || "").trim();
    if (!cid || !uid) return;

    const runCompany = companyRef.current || fallbackCompanyRef.current;
    if (!runCompany) return;

    const canFn = canRef.current;
    if (!canFn("trigger_recurring_auto_on_app_open") && !canFn("create_records")) {
      return;
    }
    if (inFlightRef.current) return;

    const bsNow = adToBs(new Date());
    const periodKey = `${bsNow.y}-${String(bsNow.m).padStart(2, "0")}`;
    const dedupeKey = `${RUNNER_SESSION_KEY_PREFIX}:v3:${cid}:${uid}:${periodKey}`;
    const navEntry =
      typeof performance !== "undefined"
        ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
        : undefined;
    const selectedEntityId = searchParams?.get("selected") || null;
    const currentPageOnly = navEntry?.type === "reload" && Boolean(selectedEntityId);
    const runKey = `${dedupeKey}:${currentPageOnly ? `page:${pathname}:${selectedEntityId}` : "global"}`;

    if (typeof window !== "undefined" && sessionStorage.getItem(runKey) === "1") return;
    if (scheduledForKeyRef.current === runKey) return;
    scheduledForKeyRef.current = runKey;

    if (cancelScheduledStartRef.current) {
      cancelScheduledStartRef.current();
      cancelScheduledStartRef.current = null;
    }
    cancelScheduledStartRef.current = scheduleAfterFirstUiPaint(() => {
      cancelScheduledStartRef.current = null;
      const liveCompany = companyRef.current || fallbackCompanyRef.current;
      if (!liveCompany || inFlightRef.current) return;
      inFlightRef.current = true;
      void (async () => {
        try {
          console.info("[RecurringVoucherAutoRunner] start", {
            companyId: cid,
            periodKey,
            currentPageOnly,
            skipCloudIO: recurringAutoRunnerSkipsCloudIO(liveCompany),
          });
          const created = await generateDueRecurringVouchersOnAppOpen(
            cid,
            liveCompany,
            {
              uid,
              email: user?.email ?? null,
              displayName: user?.displayName ?? null,
            },
            {
              hasTriggerPermission: true,
              runScope: currentPageOnly
                ? {
                    currentPageOnly: true,
                    pathname,
                    selectedEntityId,
                  }
                : undefined,
            }
          );
          if (typeof window !== "undefined") sessionStorage.setItem(runKey, "1");
          console.info("[RecurringVoucherAutoRunner] complete", { companyId: cid, periodKey, created });
        } catch (error) {
          scheduledForKeyRef.current = null;
          if (typeof window !== "undefined") sessionStorage.removeItem(runKey);
          const message = String((error as Error)?.message || "");
          if (message.startsWith(AUTO_RECURRING_SYNC_NOT_READY)) {
            console.info("[RecurringVoucherAutoRunner] sync not ready — retry later", { companyId: cid, message });
            if (typeof window !== "undefined" && syncRetryCountRef.current < SYNC_NOT_READY_MAX_RETRIES) {
              syncRetryCountRef.current += 1;
              window.setTimeout(() => setSyncRetryEpoch((n) => n + 1), SYNC_NOT_READY_RETRY_MS);
            }
          } else {
            console.error("[RecurringVoucherAutoRunner] failed", error);
          }
        } finally {
          inFlightRef.current = false;
        }
      })();
    });

    return () => {
      if (cancelScheduledStartRef.current) {
        cancelScheduledStartRef.current();
        cancelScheduledStartRef.current = null;
        if (scheduledForKeyRef.current === runKey) scheduledForKeyRef.current = null;
      }
    };
  }, [
    companyId,
    hasCompany,
    fallbackReadyEpoch,
    syncRetryEpoch,
    user?.uid,
    user?.email,
    user?.displayName,
    pathname,
    searchParams?.toString(),
  ]);

  return null;
}
